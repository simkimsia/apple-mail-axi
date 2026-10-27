/**
 * An in-memory stand-in for Mail.app behind the OsaRunner seam. It answers
 * the bundled scripts by name, records every request, and can be told to
 * misbehave (late attachments, dropped recipients, permission errors).
 * Nothing here spawns osascript.
 */
import type { CoreDeps, DraftDetail, FileSystem } from "../src/core/drafts.js";
import { defaultDeps } from "../src/core/drafts.js";
import type { OsaOutcome, OsaRequest, OsaRunner } from "../src/core/runner.js";

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

export class FakeMail {
  readonly requests: OsaRequest[] = [];
  readonly drafts: DraftDetail[];
  private nextId = 9000;
  private views = 0;

  constructor(private readonly opts: FakeMailOptions = {}) {
    this.drafts = [...(opts.drafts ?? [])];
  }

  /** Requests for one script, in order. */
  calls(script: OsaRequest["script"]): OsaRequest[] {
    return this.requests.filter((r) => r.script === script);
  }

  runner: OsaRunner = async (request) => {
    this.requests.push(request);
    if (this.opts.fail) return this.opts.fail;
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
        if (!this.opts.saveNothing)
          this.drafts.push(this.fromCreateArgv(request.argv));
        return { kind: "ok", stdout: "saved\n" };
      }
    }
  };

  /** Decode the argv layout documented in osa/create-draft.applescript. */
  private fromCreateArgv(argv: string[]): DraftDetail {
    const [subject, body, sender] = argv;
    let i = 4;
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
    const kept = files.slice(
      0,
      Math.max(0, files.length - (this.opts.dropAttachments ?? 0)),
    );
    return draft(String(this.nextId++), {
      subject,
      body,
      from: sender,
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
  let clock = 0;
  return defaultDeps({
    run: mail.runner,
    fs,
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
    cwd: () => "/work",
    verifyTimeoutMs: 5_000,
    verifyIntervalMs: 1_000,
    deleteTimeoutMs: 3_000,
    ...extra,
  });
}
