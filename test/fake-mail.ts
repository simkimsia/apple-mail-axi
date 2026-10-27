/**
 * An in-memory stand-in for Mail.app behind the OsaRunner seam. It answers
 * the bundled scripts by name, records every request, and can be told to
 * misbehave (late attachments, dropped recipients, permission errors).
 * Nothing here spawns osascript.
 *
 * It also models Mail's open outgoing messages (compose windows), following
 * what live run 1 and the probes showed: create-draft opens a visible one
 * and closes it on its own error paths; osascript dying mid-script leaves
 * it open.
 *
 * Live run 2 showed `save` returns before Mail has written the attachments
 * into the saved draft, and closing the compose window first drops them.
 * The fake models that: a saved draft gets its attachments only when a
 * later call finds the compose window still open at least
 * `attachWriteMs` after the save. Whether the script closes the window
 * right after save is read from the real script text (or `createScript`),
 * so the fake follows whatever osa/create-draft.applescript does.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CoreDeps, DraftDetail, FileSystem } from "../src/core/drafts.js";
import { defaultDeps } from "../src/core/drafts.js";
import type { OsaOutcome, OsaRequest, OsaRunner } from "../src/core/runner.js";
import type { AxiError } from "../src/core/errors.js";
import { renderSteps, type Transport } from "../src/core/steps.js";

/** An error's next steps as one way in prints them. */
export function helpOf(err: AxiError, t: Transport = "cli"): string[] {
  return renderSteps(err.steps, t);
}

export interface FakeAccount {
  name: string;
  fullName: string;
  addresses: string[];
  enabled: boolean;
}

export interface FakeMailOptions {
  accounts?: FakeAccount[];
  drafts?: DraftDetail[];
  /** Attachments appear on the saved draft only after this many view calls. */
  attachmentsAfterViews?: number;
  /** Drop this many attachments from the saved draft, forever. */
  dropAttachments?: number;
  /** Drop bcc recipients from the saved draft. */
  dropBcc?: boolean;
  /** Pretend the create saved nothing. */
  saveNothing?: boolean;
  /** Pretend delete did nothing. */
  deleteNoop?: boolean;
  /** Fail every script with this outcome. */
  fail?: OsaOutcome;
  /** Saved drafts land in this account instead of the sender's account. */
  saveToAccount?: string;
  /** Mail refuses the attachment at this index (the script's error path). */
  rejectAttachment?: number;
  /** osascript is killed mid-script: no save, compose window left open. */
  killCreate?: boolean;
  /**
   * How long after `save` Mail needs the compose window to stay open to
   * write the attachments into the saved draft. Default 0: any later call.
   */
  attachWriteMs?: number;
  /** The create script text to follow; default osa/create-draft.applescript. */
  createScript?: string;
  /** Every view-draft call fails with this outcome. */
  failViews?: OsaOutcome;
  /** Outgoing messages cannot be closed at all (the hidden-compose bug). */
  stuckOutgoing?: boolean;
  /** Compose windows the user already has open. */
  outgoing?: FakeOutgoing[];
}

export interface FakeOutgoing {
  id: string;
  subject: string;
}

export const DEFAULT_ACCOUNTS: FakeAccount[] = [
  {
    name: "Work",
    fullName: "Kim Sia",
    addresses: ["kim@work.example"],
    enabled: true,
  },
  {
    name: "Home",
    fullName: "",
    addresses: ["kim@home.example", "k@home.example"],
    enabled: true,
  },
  { name: "Old", fullName: "", addresses: ["old@old.example"], enabled: false },
];

export function draft(
  id: string,
  extra: Partial<DraftDetail> = {},
): DraftDetail {
  return {
    id,
    subject: `Subject ${id}`,
    from: "Kim Sia <kim@work.example>",
    to: ["ana@example.com"],
    cc: [],
    bcc: [],
    account: "Work",
    mailbox: "Drafts",
    date: "2026-10-27T08:00:00.000Z",
    attachments: [],
    body: "hello",
    ...extra,
  };
}

/**
 * Whether a create script closes its compose window right after a
 * successful `save` (take 2 did; Live run 2 showed that drops attachments).
 * True when the success path after the main try block calls discardMessage.
 */
export function closesAfterSave(script: string): boolean {
  const code = script
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");
  const saveAt = code.lastIndexOf("save draftMessage");
  const tryEnd = code.indexOf("\n\tend try", saveAt);
  const runEnd = code.indexOf("end run", tryEnd);
  if (saveAt === -1 || tryEnd === -1 || runEnd === -1) {
    throw new Error("unrecognised create script layout");
  }
  return /my discardMessage\(draftMessage\)/.test(code.slice(tryEnd, runEnd));
}

const REAL_CREATE_SCRIPT = readFileSync(
  join(import.meta.dirname, "..", "osa", "create-draft.applescript"),
  "utf-8",
);

interface PendingAttachments {
  draftId: string;
  composeId: string;
  savedAt: number;
  attachments: DraftDetail["attachments"];
}

export class FakeMail {
  readonly requests: OsaRequest[] = [];
  readonly drafts: DraftDetail[];
  readonly outgoing: FakeOutgoing[];
  /** Virtual clock in ms, advanced by fakeDeps' sleep. */
  clock = 0;
  private nextId = 9000;
  private nextOutgoingId = 500;
  private views = 0;
  private pending: PendingAttachments[] = [];
  private readonly closeAfterSave: boolean;

  constructor(private readonly opts: FakeMailOptions = {}) {
    this.drafts = [...(opts.drafts ?? [])];
    this.outgoing = [...(opts.outgoing ?? [])];
    this.closeAfterSave = closesAfterSave(
      opts.createScript ?? REAL_CREATE_SCRIPT,
    );
  }

  /** Mail finishes writing attachments for drafts whose window is open. */
  private flushAttachments(): void {
    const wait = this.opts.attachWriteMs ?? 0;
    this.pending = this.pending.filter((p) => {
      const open = this.outgoing.some((o) => o.id === p.composeId);
      if (!open || this.clock - p.savedAt < wait) return true;
      const d = this.drafts.find((x) => x.id === p.draftId);
      if (d) d.attachments = p.attachments;
      return false;
    });
  }

  private close(id: string): void {
    if (this.opts.stuckOutgoing) return;
    const i = this.outgoing.findIndex((o) => o.id === id);
    if (i === -1) return;
    this.outgoing.splice(i, 1);
    // Closed before Mail wrote them: the attachments are lost for good.
    this.pending = this.pending.filter((p) => p.composeId !== id);
  }

  /** Requests for one script, in order. */
  calls(script: OsaRequest["script"]): OsaRequest[] {
    return this.requests.filter((r) => r.script === script);
  }

  runner: OsaRunner = async (request) => {
    this.requests.push(request);
    if (this.opts.fail) return this.opts.fail;
    this.flushAttachments();
    const ok = (value: unknown): OsaOutcome => ({
      kind: "ok",
      stdout: JSON.stringify(value),
    });
    switch (request.script) {
      case "preflight":
        return ok({
          accounts: this.opts.accounts ?? DEFAULT_ACCOUNTS,
          draftIds: this.drafts.map((d) => d.id),
        });
      case "list-drafts": {
        const [mode, limit] = request.argv;
        const sorted = [...this.drafts].sort(
          (a, b) => Number(b.id) - Number(a.id),
        );
        if (mode === "ids") {
          return ok({
            total: sorted.length,
            drafts: sorted.map((d) => ({ id: d.id, subject: d.subject })),
          });
        }
        return ok({
          total: sorted.length,
          drafts: sorted.slice(0, Number(limit)).map((d) => ({
            id: d.id,
            subject: d.subject,
            to: d.to,
            attachments: d.attachments.length,
            account: d.account,
            date: d.date,
          })),
        });
      }
      case "view-draft": {
        this.views++;
        if (this.opts.failViews) return this.opts.failViews;
        const d = this.drafts.find((x) => x.id === request.argv[0]);
        if (!d) return notFound(request.argv[0]);
        const late = this.opts.attachmentsAfterViews ?? 0;
        return ok(this.views > late ? d : { ...d, attachments: [] });
      }
      case "delete-draft": {
        const i = this.drafts.findIndex((x) => x.id === request.argv[0]);
        if (i === -1) return notFound(request.argv[0]);
        const d = this.drafts[i];
        if (!this.opts.deleteNoop) this.drafts.splice(i, 1);
        return ok({ id: d.id, subject: d.subject, account: d.account });
      }
      case "create-draft": {
        const compose = {
          id: String(this.nextOutgoingId++),
          subject: request.argv[0],
        };
        this.outgoing.push(compose);
        if (this.opts.killCreate) return { kind: "timeout" };
        const files = this.createLists(request.argv).files;
        const bad = this.opts.rejectAttachment;
        if (bad !== undefined && bad < files.length) {
          // The script's on-error handler closes the window, then rethrows.
          this.close(compose.id);
          return {
            kind: "exit",
            exitCode: 1,
            stderr: `/x/osa/create-draft.applescript: execution error: AMA_ERR:ATTACHMENT_REJECTED:${files[bad]} (9003)\n`,
          };
        }
        if (!this.opts.saveNothing) {
          const saved = this.fromCreateArgv(request.argv);
          // `save` returns before Mail writes the attachments in.
          this.pending.push({
            draftId: saved.id,
            composeId: compose.id,
            savedAt: this.clock,
            attachments: saved.attachments,
          });
          this.drafts.push({ ...saved, attachments: [] });
        }
        if (this.closeAfterSave) this.close(compose.id);
        return { kind: "ok", stdout: "saved\n" };
      }
      case "list-outgoing":
        return ok({ outgoing: this.outgoing });
      case "discard-outgoing": {
        for (const id of request.argv) this.close(id);
        return { kind: "ok", stdout: "done\n" };
      }
    }
  };

  /** Decode the counted lists of the create argv (from index 5). */
  private createLists(argv: string[]) {
    let i = 5;
    const take = () => {
      const n = Number(argv[i]);
      const out = argv.slice(i + 1, i + 1 + n);
      i += n + 1;
      return out;
    };
    const to = take();
    const cc = take();
    const bcc = take();
    const files = take();
    return { to, cc, bcc, files };
  }

  /** The account a sender string belongs to, like Mail would pick. */
  private accountFor(sender: string): string {
    const accounts = this.opts.accounts ?? DEFAULT_ACCOUNTS;
    const lower = sender.toLowerCase();
    const hit = accounts.find((a) =>
      a.addresses.some((addr) => lower.includes(addr.toLowerCase())),
    );
    return hit?.name ?? accounts[0].name;
  }

  /** Decode the argv layout documented in osa/create-draft.applescript. */
  private fromCreateArgv(argv: string[]): DraftDetail {
    const [subject, body, sender] = argv;
    const { to, cc, bcc, files } = this.createLists(argv);
    const account = this.opts.saveToAccount ?? this.accountFor(sender);
    const fallbackFrom = "Kim Sia <kim@work.example>";
    const kept = files.slice(
      0,
      Math.max(0, files.length - (this.opts.dropAttachments ?? 0)),
    );
    return draft(String(this.nextId++), {
      subject,
      body,
      from: sender || fallbackFrom,
      account,
      to,
      cc,
      bcc: this.opts.dropBcc ? [] : bcc,
      attachments: kept.map((f) => ({
        name: f.split("/").pop() ?? f,
        size: 10,
      })),
    });
  }
}

function notFound(id: string): OsaOutcome {
  return {
    kind: "exit",
    exitCode: 1,
    stderr: `/x/osa/view-draft.js: execution error: Error: AMA_ERR:DRAFT_NOT_FOUND:${id} (-2700)\n`,
  };
}

/** A file system where only the listed paths exist. */
export function fakeFs(
  files: Record<string, "file" | "directory" | "unreadable"> = {},
  texts: Record<string, string> = {},
): FileSystem {
  const enoent = () => Object.assign(new Error("ENOENT"), { code: "ENOENT" });
  return {
    async kind(path) {
      const k = files[path];
      if (!k) throw enoent();
      return k === "directory" ? "directory" : "file";
    },
    async readable(path) {
      if (files[path] === "unreadable")
        throw Object.assign(new Error("EACCES"), { code: "EACCES" });
    },
    async readText(path) {
      if (!(path in texts)) throw enoent();
      return texts[path];
    },
  };
}

/** Deps wired to a FakeMail with a virtual clock (sleep advances time). */
export function fakeDeps(
  mail: FakeMail,
  fs: FileSystem = fakeFs(),
  extra: Partial<CoreDeps> = {},
): CoreDeps {
  return defaultDeps({
    run: mail.runner,
    fs,
    now: () => mail.clock,
    sleep: async (ms) => {
      mail.clock += ms;
    },
    cwd: () => "/work",
    verifyTimeoutMs: 5_000,
    verifyIntervalMs: 1_000,
    deleteTimeoutMs: 3_000,
    ...extra,
  });
}
