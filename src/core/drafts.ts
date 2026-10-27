/**
 * All mail logic lives here. The CLI (src/cli) and the MCP server (src/mcp)
 * only translate their transport into these inputs and render the results.
 */
import { constants as fsConstants } from "node:fs";
import { access, readFile, stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { AxiError, validationError } from "./errors.js";
import { defaultRunner, runJson, runScript, type OsaRunner } from "./runner.js";

// ---------------------------------------------------------------------------
// Dependencies (injectable for tests)
// ---------------------------------------------------------------------------

export interface FileSystem {
  /** Resolves to "file", "directory" or "other"; rejects like fs.stat. */
  kind(path: string): Promise<"file" | "directory" | "other">;
  /** Rejects when the file cannot be read by this process. */
  readable(path: string): Promise<void>;
  readText(path: string): Promise<string>;
}

export interface CoreDeps {
  run: OsaRunner;
  fs: FileSystem;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  cwd: () => string;
  /** How long create waits for the saved draft to read back correctly. */
  verifyTimeoutMs: number;
  verifyIntervalMs: number;
  /** How long delete waits for the draft to leave Drafts. */
  deleteTimeoutMs: number;
}

export const nodeFs: FileSystem = {
  async kind(path) {
    const s = await stat(path);
    return s.isFile() ? "file" : s.isDirectory() ? "directory" : "other";
  },
  async readable(path) {
    await access(path, fsConstants.R_OK);
  },
  readText(path) {
    return readFile(path, "utf-8");
  },
};

export function defaultDeps(overrides: Partial<CoreDeps> = {}): CoreDeps {
  return {
    run: defaultRunner,
    fs: nodeFs,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    now: () => Date.now(),
    cwd: () => process.cwd(),
    verifyTimeoutMs: 30_000,
    verifyIntervalMs: 1_000,
    deleteTimeoutMs: 10_000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Inputs and results
// ---------------------------------------------------------------------------

/** Raw input as either transport hands it over; validated here, not there. */
export interface CreateDraftInput {
  to?: string[];
  cc?: string[];
  bcc?: string[];
  subject?: string;
  body?: string;
  bodyFile?: string;
  attach?: string[];
  from?: string;
}

export interface ListDraftsInput {
  limit?: number | string;
}

export interface ViewDraftInput {
  id?: string;
  full?: boolean;
}

export interface DeleteDraftInput {
  id?: string;
}

export interface DraftRow {
  id: string;
  subject: string;
  to: string[];
  attachments: number;
  account: string;
  date: string;
}

export interface DraftDetail {
  id: string;
  subject: string;
  from: string;
  to: string[];
  cc: string[];
  bcc: string[];
  account: string;
  mailbox: string;
  date: string;
  attachments: { name: string; size: number }[];
  body: string;
}

export interface CreateDraftResult {
  draft: DraftDetail;
  /** Milliseconds spent waiting for Mail to show the draft correctly. */
  verifiedAfterMs: number;
}

export interface ListDraftsResult {
  total: number;
  drafts: DraftRow[];
}

export interface ViewDraftResult {
  draft: DraftDetail;
  full: boolean;
}

export interface DeleteDraftResult {
  id: string;
  subject: string;
  account: string;
}

interface Account {
  name: string;
  fullName: string;
  addresses: string[];
  enabled: boolean;
}

interface Preflight {
  accounts: Account[];
  draftIds: string[];
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export const MAX_BODY_CHARS = 200_000;
export const MAX_ATTACHMENTS = 20;
export const DEFAULT_LIST_LIMIT = 50;
export const MAX_LIST_LIMIT = 500;

const ADDRESS = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;

function addresses(field: string, values: string[] | undefined): string[] {
  const list = (values ?? []).map((v) => v.trim());
  for (const v of list) {
    if (!ADDRESS.test(v)) {
      throw validationError(
        `${field} ${JSON.stringify(v)} is not a plain email address`,
        [
          `Pass one bare address per ${field}, e.g. \`${field} name@example.com\`; repeat ${field} for more`,
        ],
      );
    }
  }
  return list;
}

/** Draft ids are Mail's integer message ids, named in full (VISION Safety). */
export function requireDraftId(id: string | undefined): string {
  if (id === undefined || id.trim() === "") {
    throw validationError("draft id is required", [
      "Run `apple-mail-axi draft list` to see draft ids",
    ]);
  }
  if (!/^\d+$/.test(id)) {
    throw validationError(
      `draft id must be the full numeric id from \`draft list\`, got ${JSON.stringify(id)}`,
      ["Run `apple-mail-axi draft list` and copy the id exactly"],
    );
  }
  return id;
}

function listLimit(raw: number | string | undefined): number {
  if (raw === undefined) return DEFAULT_LIST_LIMIT;
  const text = String(raw);
  if (!/^\d+$/.test(text) || Number(text) < 1) {
    throw validationError(
      `limit must be a whole number of at least 1, got ${text}`,
      [`Pass e.g. \`--limit ${DEFAULT_LIST_LIMIT}\``],
    );
  }
  return Math.min(Number(text), MAX_LIST_LIMIT);
}

export interface NormalizedCreate {
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
  attach: string[];
  from?: string;
}

/** Validate everything that can be checked without Mail. */
export async function normalizeCreate(
  input: CreateDraftInput,
  deps: Pick<CoreDeps, "fs" | "cwd">,
): Promise<NormalizedCreate> {
  const subject = (input.subject ?? "").trim();
  if (subject === "") {
    throw validationError("subject is required", [
      'Pass `--subject "..."`; the subject is how the saved draft is found and verified',
    ]);
  }
  if (/[\r\n]/.test(subject)) {
    throw validationError("subject must be one line", [
      "Remove line breaks from the subject",
    ]);
  }
  if (input.body !== undefined && input.bodyFile !== undefined) {
    throw validationError("pass the body once: body or body file, not both", [
      'Use `--body "..."` for short text, or `--body-file <path>` (`--body-file -` reads stdin)',
    ]);
  }
  let body = input.body ?? "";
  if (input.bodyFile !== undefined) {
    if (input.bodyFile === "-") {
      throw validationError(
        "body file `-` (stdin) is only available on the CLI",
        ["Pass the text in `body` instead"],
      );
    }
    const path = absolute(input.bodyFile, deps.cwd());
    try {
      body = await deps.fs.readText(path);
    } catch (e) {
      throw validationError(`cannot read body file ${path}: ${reason(e)}`, [
        "Check the path, or pass the text with `--body`",
      ]);
    }
  }
  if (body.length > MAX_BODY_CHARS) {
    throw validationError(
      `body is ${body.length} chars; the limit is ${MAX_BODY_CHARS}`,
      ["Shorten the body, or attach the long text as a file with `--attach`"],
    );
  }
  const to = addresses("--to", input.to);
  const cc = addresses("--cc", input.cc);
  const bcc = addresses("--bcc", input.bcc);

  const attachInput = input.attach ?? [];
  if (attachInput.length > MAX_ATTACHMENTS) {
    throw validationError(
      `${attachInput.length} attachments; the limit is ${MAX_ATTACHMENTS}`,
      ["Zip the files into one archive and attach that"],
    );
  }
  const attach: string[] = [];
  for (const raw of attachInput) {
    attach.push(await checkAttachment(raw, deps));
  }
  const from = input.from?.trim() || undefined;
  return { to, cc, bcc, subject, body, attach, from };
}

function absolute(path: string, cwd: string): string {
  const expanded = path.startsWith("~/")
    ? `${process.env.HOME ?? "~"}${path.slice(1)}`
    : path;
  return isAbsolute(expanded) ? expanded : resolve(cwd, expanded);
}

function reason(e: unknown): string {
  const code = (e as { code?: string }).code;
  return code ?? (e instanceof Error ? e.message : String(e));
}

/** Resolve and check one attachment before Mail is touched. */
export async function checkAttachment(
  raw: string,
  deps: Pick<CoreDeps, "fs" | "cwd">,
): Promise<string> {
  const path = absolute(raw, deps.cwd());
  let kind: "file" | "directory" | "other";
  try {
    kind = await deps.fs.kind(path);
  } catch (e) {
    if (reason(e) === "ENOENT" || reason(e) === "ENOTDIR") {
      throw new AxiError(
        `Attachment not found: ${path}`,
        "ATTACHMENT_NOT_FOUND",
        [`Check the path; relative paths resolve against ${deps.cwd()}`],
      );
    }
    throw new AxiError(
      `Attachment unreadable: ${path} (${reason(e)})`,
      "ATTACHMENT_UNREADABLE",
      [
        `Check permissions with \`ls -l ${path}\`, or copy the file somewhere readable and attach the copy`,
      ],
    );
  }
  if (kind !== "file") {
    throw new AxiError(
      `Attachment is not a regular file: ${path} (${kind})`,
      "ATTACHMENT_UNREADABLE",
      ["Attach files only; zip a folder first and attach the archive"],
    );
  }
  try {
    await deps.fs.readable(path);
  } catch (e) {
    throw new AxiError(
      `Attachment unreadable: ${path} (${reason(e)})`,
      "ATTACHMENT_UNREADABLE",
      [
        `Check permissions with \`ls -l ${path}\`, or copy the file somewhere readable and attach the copy`,
      ],
    );
  }
  return path;
}

// ---------------------------------------------------------------------------
// Sender resolution
// ---------------------------------------------------------------------------

/** Map `--from` (account name or address) to the sender string Mail expects. */
export function resolveSender(
  from: string | undefined,
  accounts: Account[],
): string {
  if (from === undefined) return "";
  const wanted = from.toLowerCase();
  for (const account of accounts) {
    if (!account.enabled) continue;
    const byAddress = account.addresses.find((a) => a.toLowerCase() === wanted);
    const address =
      byAddress ??
      (account.name.toLowerCase() === wanted
        ? account.addresses[0]
        : undefined);
    if (address) {
      return account.fullName ? `${account.fullName} <${address}>` : address;
    }
  }
  const choices = accounts
    .filter((a) => a.enabled)
    .map((a) => `${a.name}: ${a.addresses.join(", ") || "(no address)"}`);
  throw new AxiError(
    `No enabled Mail account matches --from ${from}`,
    "UNKNOWN_SENDER",
    [
      ...(choices.length > 0
        ? [
            `Pass one of these account names or addresses to --from: ${choices.join("; ")}`,
          ]
        : ["Ask the user to enable an account in Mail > Settings > Accounts"]),
      "Or leave --from out to use Mail's default account",
    ],
  );
}

// ---------------------------------------------------------------------------
// argv building (values only ever travel as argv)
// ---------------------------------------------------------------------------

/** Settle time Mail gets to load attachments before the save. */
export function settleMs(attachments: number): number {
  return attachments === 0 ? 0 : Math.min(2_000 + 1_000 * attachments, 15_000);
}

/** argv for osa/create-draft.applescript; layout documented in that file. */
export function buildCreateArgv(
  draft: NormalizedCreate,
  sender: string,
): string[] {
  const counted = (list: string[]) => [String(list.length), ...list];
  return [
    draft.subject,
    draft.body,
    sender,
    String(settleMs(draft.attach.length)),
    ...counted(draft.to),
    ...counted(draft.cc),
    ...counted(draft.bcc),
    ...counted(draft.attach),
  ];
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

const norm = (list: string[]) => list.map((a) => a.trim().toLowerCase()).sort();

/** Differences between what was asked for and what Mail saved. Empty = match. */
export function compareDraft(
  wanted: NormalizedCreate,
  saved: DraftDetail,
): string[] {
  const diffs: string[] = [];
  if (saved.subject.trim() !== wanted.subject) {
    diffs.push(
      `subject is ${JSON.stringify(saved.subject)}, wanted ${JSON.stringify(wanted.subject)}`,
    );
  }
  for (const field of ["to", "cc", "bcc"] as const) {
    const a = norm(saved[field]);
    const b = norm(wanted[field]);
    if (a.join(",") !== b.join(",")) {
      diffs.push(`${field} is [${a.join(", ")}], wanted [${b.join(", ")}]`);
    }
  }
  if (saved.attachments.length !== wanted.attach.length) {
    diffs.push(
      `attachments ${saved.attachments.length} of ${wanted.attach.length}`,
    );
  }
  return diffs;
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

async function preflight(deps: CoreDeps): Promise<Preflight> {
  return runJson<Preflight>(deps.run, { script: "preflight", argv: [] });
}

async function draftIds(
  deps: CoreDeps,
): Promise<{ id: string; subject: string }[]> {
  const out = await runJson<{ drafts: { id: string; subject: string }[] }>(
    deps.run,
    {
      script: "list-drafts",
      argv: ["ids", "0"],
    },
  );
  return out.drafts;
}

async function fetchDraft(deps: CoreDeps, id: string): Promise<DraftDetail> {
  return runJson<DraftDetail>(
    deps.run,
    { script: "view-draft", argv: [id] },
    { id },
  );
}

export async function createDraft(
  input: CreateDraftInput,
  deps: CoreDeps = defaultDeps(),
): Promise<CreateDraftResult> {
  const draft = await normalizeCreate(input, deps);
  const before = await preflight(deps);
  const sender = resolveSender(draft.from, before.accounts);
  const known = new Set(before.draftIds);

  await runScript(deps.run, {
    script: "create-draft",
    argv: buildCreateArgv(draft, sender),
  });

  // Read back until Mail shows a new draft that matches, or time runs out.
  // Attachments in particular can land a moment after the draft itself.
  const started = deps.now();
  let lastSeen: DraftDetail | undefined;
  for (;;) {
    const fresh = (await draftIds(deps))
      .filter((d) => !known.has(d.id) && d.subject.trim() === draft.subject)
      .sort((a, b) => Number(b.id) - Number(a.id));
    for (const candidate of fresh) {
      let saved: DraftDetail;
      try {
        saved = await fetchDraft(deps, candidate.id);
      } catch (e) {
        // A synced account can replace the local copy under a new id.
        if (e instanceof AxiError && e.code === "DRAFT_NOT_FOUND") continue;
        throw e;
      }
      lastSeen = saved;
      if (compareDraft(draft, saved).length === 0) {
        return { draft: saved, verifiedAfterMs: deps.now() - started };
      }
    }
    if (deps.now() - started >= deps.verifyTimeoutMs) break;
    await deps.sleep(deps.verifyIntervalMs);
  }

  const seconds = Math.round(deps.verifyTimeoutMs / 1000);
  if (!lastSeen) {
    throw new AxiError(
      `Mail did not show the new draft in Drafts within ${seconds}s`,
      "DRAFT_NOT_SAVED",
      [
        `Run \`apple-mail-axi draft list\` to check whether it appeared late before creating it again, or you may get a duplicate`,
      ],
    );
  }
  const diffs = compareDraft(draft, lastSeen);
  throw new AxiError(
    `Saved draft ${lastSeen.id} does not match the request: ${diffs.join("; ")}`,
    "DRAFT_MISMATCH",
    [
      `Run \`apple-mail-axi draft view ${lastSeen.id}\` to inspect it`,
      `Run \`apple-mail-axi draft delete ${lastSeen.id}\`, then create it again`,
    ],
  );
}

export async function listDrafts(
  input: ListDraftsInput,
  deps: CoreDeps = defaultDeps(),
): Promise<ListDraftsResult> {
  const limit = listLimit(input.limit);
  return runJson<ListDraftsResult>(deps.run, {
    script: "list-drafts",
    argv: ["rows", String(limit)],
  });
}

export async function viewDraft(
  input: ViewDraftInput,
  deps: CoreDeps = defaultDeps(),
): Promise<ViewDraftResult> {
  const id = requireDraftId(input.id);
  return { draft: await fetchDraft(deps, id), full: input.full === true };
}

export async function deleteDraft(
  input: DeleteDraftInput,
  deps: CoreDeps = defaultDeps(),
): Promise<DeleteDraftResult> {
  const id = requireDraftId(input.id);
  const removed = await runJson<DeleteDraftResult>(
    deps.run,
    { script: "delete-draft", argv: [id] },
    { id },
  );
  // Report success only once Drafts no longer lists the id.
  const started = deps.now();
  for (;;) {
    const ids = await draftIds(deps);
    if (!ids.some((d) => d.id === id)) return removed;
    if (deps.now() - started >= deps.deleteTimeoutMs) break;
    await deps.sleep(deps.verifyIntervalMs);
  }
  throw new AxiError(
    `Mail accepted the delete, but draft ${id} is still in Drafts`,
    "DELETE_NOT_CONFIRMED",
    [`Run \`apple-mail-axi draft view ${id}\` to check, then rerun the delete`],
  );
}
