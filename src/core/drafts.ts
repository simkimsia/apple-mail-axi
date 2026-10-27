/**
 * All mail logic lives here. The CLI (src/cli) and the MCP server (src/mcp)
 * only translate their transport into these inputs and render the results.
 */
import { constants as fsConstants } from "node:fs";
import { access, readFile, stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import {
  AxiError,
  call,
  composeLeftOpenError,
  composeLeftOpenSteps,
  param,
  validationError,
} from "./errors.js";
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

function addresses(
  field: "to" | "cc" | "bcc",
  values: string[] | undefined,
): string[] {
  const list = (values ?? []).map((v) => v.trim());
  for (const v of list) {
    if (!ADDRESS.test(v)) {
      throw validationError(
        `${field} address ${JSON.stringify(v)} is not a plain email address`,
        [
          [
            "Pass bare addresses only in ",
            param(field),
            ", one per entry, e.g. name@example.com",
          ],
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
      [call("draft_list"), " to see draft ids"],
    ]);
  }
  if (!/^\d+$/.test(id)) {
    throw validationError(
      `draft id must be the full numeric id from the draft list, got ${JSON.stringify(id)}`,
      [[call("draft_list"), " and copy the id exactly"]],
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
      [
        [
          "Pass ",
          param("limit"),
          ` as a whole number, e.g. ${DEFAULT_LIST_LIMIT}`,
        ],
      ],
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
      [
        "Pass ",
        param("subject"),
        "; the subject is how the saved draft is found and verified",
      ],
    ]);
  }
  if (/[\r\n]/.test(subject)) {
    throw validationError("subject must be one line", [
      "Remove line breaks from the subject",
    ]);
  }
  if (input.body !== undefined && input.bodyFile !== undefined) {
    throw validationError("pass the body once: body or body file, not both", [
      [
        "Use ",
        param("body"),
        " for short text, or ",
        param("bodyFile"),
        " with a file path",
      ],
    ]);
  }
  let body = input.body ?? "";
  if (input.bodyFile !== undefined) {
    if (input.bodyFile === "-") {
      throw validationError(
        "body file `-` (stdin) is only available on the CLI",
        [["Pass the text in ", param("body"), " instead"]],
      );
    }
    const path = absolute(input.bodyFile, deps.cwd());
    try {
      body = await deps.fs.readText(path);
    } catch (e) {
      throw validationError(`cannot read body file ${path}: ${reason(e)}`, [
        ["Check the path, or pass the text in ", param("body")],
      ]);
    }
  }
  if (body.length > MAX_BODY_CHARS) {
    throw validationError(
      `body is ${body.length} chars; the limit is ${MAX_BODY_CHARS}`,
      [
        [
          "Shorten the body, or attach the long text as a file with ",
          param("attach"),
        ],
      ],
    );
  }
  const to = addresses("to", input.to);
  const cc = addresses("cc", input.cc);
  const bcc = addresses("bcc", input.bcc);

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

export interface ResolvedSender {
  /** What `set sender` gets: `Full Name <address>`, or "" for Mail's default. */
  sender: string;
  /** The bare address the draft must be from, when one was asked for. */
  address?: string;
  /** The Mail account name, used to scope the read-back to its Drafts. */
  account?: string;
}

/** Map `from` (account name or address) to the sender string Mail expects. */
export function resolveSender(
  from: string | undefined,
  accounts: Account[],
): ResolvedSender {
  if (from === undefined) return { sender: "" };
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
      return {
        sender: account.fullName ? `${account.fullName} <${address}>` : address,
        address,
        account: account.name,
      };
    }
  }
  const choices = accounts
    .filter((a) => a.enabled)
    .map((a) => `${a.name}: ${a.addresses.join(", ") || "(no address)"}`);
  throw new AxiError(
    `No enabled Mail account matches the sender ${JSON.stringify(from)}`,
    "UNKNOWN_SENDER",
    [
      choices.length > 0
        ? [
            "Pass one of these account names or addresses in ",
            param("from"),
            `: ${choices.join("; ")}`,
          ]
        : "Ask the user to enable an account in Mail > Settings > Accounts",
      ["Or leave ", param("from"), " out to use Mail's default account"],
    ],
  );
}

// ---------------------------------------------------------------------------
// argv building (values only ever travel as argv)
// ---------------------------------------------------------------------------

/** Longest the script polls for attachments to register before the save. */
export function settleMs(attachments: number): number {
  return attachments === 0 ? 0 : Math.min(2_000 + 1_000 * attachments, 15_000);
}

/**
 * Fixed pause before `save`. The live probe on 2026-10-27 (iCloud) that
 * landed a draft with its attachment used `delay 2` before saving.
 */
export const SAVE_PAUSE_MS = 2_000;

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
    String(SAVE_PAUSE_MS),
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
  fromAddress?: string,
): string[] {
  const diffs: string[] = [];
  if (
    fromAddress !== undefined &&
    !saved.from.toLowerCase().includes(fromAddress.toLowerCase())
  ) {
    diffs.push(
      `from is ${JSON.stringify(saved.from)}, wanted ${JSON.stringify(fromAddress)}`,
    );
  }
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

interface OutgoingRow {
  id: string;
  subject: string;
}

/** Mail's open outgoing messages (compose windows). Read-only. */
async function listOutgoing(deps: CoreDeps): Promise<OutgoingRow[]> {
  const out = await runJson<{ outgoing: OutgoingRow[] }>(deps.run, {
    script: "list-outgoing",
    argv: [],
  });
  return out.outgoing;
}

/**
 * Close, without saving, every outgoing message this create opened: new
 * since `before` and with the exact subject. Compose windows the user had
 * open before are never touched. Returns how many of ours are still open.
 *
 * This is how create closes its compose window after a save, once the
 * read-back is done. The script closes its own message only on its error
 * path; this also catches the paths it never reaches (osascript killed by
 * the timeout).
 */
async function discardOurOutgoing(
  deps: CoreDeps,
  before: Set<string>,
  subject: string,
): Promise<number> {
  const ours = (rows: OutgoingRow[]) =>
    rows.filter((r) => !before.has(r.id) && r.subject.trim() === subject);
  const open = ours(await listOutgoing(deps));
  if (open.length === 0) return 0;
  const closable = open.filter((r) => /^\d+$/.test(r.id)).map((r) => r.id);
  if (closable.length > 0) {
    await runScript(deps.run, { script: "discard-outgoing", argv: closable });
  }
  // A window can take a moment to go after its close; look a few times.
  let left = ours(await listOutgoing(deps)).length;
  for (let i = 1; left > 0 && i < DISCARD_CHECKS; i++) {
    await deps.sleep(deps.verifyIntervalMs);
    left = ours(await listOutgoing(deps)).length;
  }
  return left;
}

/** How many times the core looks for a leftover compose window after closing. */
const DISCARD_CHECKS = 3;

/**
 * Read the saved draft back until Mail shows a new draft that matches, or
 * the budget that began at `started` runs out. Candidates: ids that were
 * not in Drafts before, with the exact subject, and (when a sender was
 * asked for) in that account's Drafts. Always looks at least once.
 */
async function awaitSavedDraft(
  deps: CoreDeps,
  draft: NormalizedCreate,
  from: ResolvedSender,
  known: Set<string>,
  started: number,
): Promise<{ match?: DraftDetail; lastSeen?: DraftDetail }> {
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
      // Another account's draft with the same subject is not ours. An empty
      // account means Mail could not say; the from check below still applies.
      if (from.account && saved.account && saved.account !== from.account) {
        continue;
      }
      lastSeen = saved;
      if (compareDraft(draft, saved, from.address).length === 0) {
        return { match: saved, lastSeen };
      }
    }
    if (deps.now() - started >= deps.verifyTimeoutMs) return { lastSeen };
    await deps.sleep(deps.verifyIntervalMs);
  }
}

function readBackError(
  draft: NormalizedCreate,
  from: ResolvedSender,
  lastSeen: DraftDetail | undefined,
  deps: CoreDeps,
): AxiError {
  const seconds = Math.round(deps.verifyTimeoutMs / 1000);
  if (!lastSeen) {
    const where = from.account ? `the ${from.account} Drafts` : "Drafts";
    return new AxiError(
      `Mail did not show the new draft in ${where} within ${seconds}s`,
      "DRAFT_NOT_SAVED",
      [
        [
          call("draft_list"),
          " to check whether it appeared late before creating it again, or you may get a duplicate",
        ],
      ],
    );
  }
  const diffs = compareDraft(draft, lastSeen, from.address);
  return new AxiError(
    `Saved draft ${lastSeen.id} does not match the request: ${diffs.join("; ")}`,
    "DRAFT_MISMATCH",
    [
      [call("draft_view", { id: lastSeen.id }), " to inspect it"],
      [call("draft_delete", { id: lastSeen.id }), ", then create it again"],
    ],
  );
}

/**
 * Create sequence (see AGENTS.md Mail.app notes for the evidence):
 *
 * 1. Validate everything that can be checked without Mail.
 * 2. Preflight: accounts (to resolve the sender) and the Drafts ids now.
 * 3. Note the compose windows already open, so the user's are never touched.
 * 4. The script opens a visible compose, adds the parts, saves, and returns
 *    with the window still open (it closes it itself only on its own error).
 * 5. While the window is open, poll the saved draft until recipients,
 *    subject, sender and attachment count match. Live run 2 showed that
 *    closing right after `save` drops the attachment.
 * 6. Close our compose window without saving, on every path.
 * 7. On a match, read the draft once more after the close to confirm it
 *    survived; otherwise raise the read-back error.
 */
export async function createDraft(
  input: CreateDraftInput,
  deps: CoreDeps = defaultDeps(),
): Promise<CreateDraftResult> {
  const draft = await normalizeCreate(input, deps);
  const before = await preflight(deps);
  const from = resolveSender(draft.from, before.accounts);
  const known = new Set(before.draftIds);
  const outgoingBefore = new Set((await listOutgoing(deps)).map((r) => r.id));

  let failure: unknown;
  let verified: DraftDetail | undefined;
  const started = deps.now();
  try {
    await runScript(deps.run, {
      script: "create-draft",
      argv: buildCreateArgv(draft, from.sender),
    });
    const seen = await awaitSavedDraft(deps, draft, from, known, started);
    if (seen.match) verified = seen.match;
    else failure = readBackError(draft, from, seen.lastSeen, deps);
  } catch (e) {
    failure = e;
  }

  // Never leave a compose window of ours behind, on success or failure.
  let left = 0;
  try {
    left = await discardOurOutgoing(deps, outgoingBefore, draft.subject);
  } catch (e) {
    if (failure === undefined) throw e;
  }
  if (failure !== undefined) {
    if (left > 0 && failure instanceof AxiError) {
      throw new AxiError(failure.message, failure.code, [
        ...failure.steps,
        ...composeLeftOpenSteps(draft.subject),
      ]);
    }
    throw failure;
  }
  if (left > 0) throw composeLeftOpenError(draft.subject);

  // The window is closed now; confirm the saved draft survived the close.
  const after = await awaitSavedDraft(deps, draft, from, known, started);
  if (after.match) {
    return { draft: after.match, verifiedAfterMs: deps.now() - started };
  }
  throw readBackError(draft, from, after.lastSeen ?? verified, deps);
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
    [[call("draft_view", { id }), " to check, then retry the delete"]],
  );
}
