/**
 * Live run 1 showed a stuck outgoing message (compose window) is the worst
 * failure create can have: it hides in Mail until Mail quits. Create must
 * leave no outgoing message of its own behind, on success and on every
 * failure path, and must never touch the user's own compose windows.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AxiError } from "../src/core/errors.js";
import { createDraft, type CreateDraftInput } from "../src/core/drafts.js";
import {
  draft,
  FakeMail,
  fakeDeps,
  fakeFs,
  helpOf,
  type FakeMailOptions,
} from "./fake-mail.js";

const files = fakeFs({ "/work/a.pdf": "file" });
const input: CreateDraftInput = {
  to: ["ana@example.com"],
  subject: "Q3 notes",
  body: "Hi",
  attach: ["a.pdf"],
};

async function run(opts: FakeMailOptions, extra: CreateDraftInput = {}) {
  const mail = new FakeMail(opts);
  const err = await createDraft(
    { ...input, ...extra },
    fakeDeps(mail, files),
  ).then(
    () => undefined,
    (e) => e as AxiError,
  );
  return { mail, err };
}

describe("create leaves no outgoing message behind", () => {
  const paths: [string, FakeMailOptions, string | undefined][] = [
    ["success", {}, undefined],
    [
      "Mail refuses an attachment",
      { rejectAttachment: 0 },
      "ATTACHMENT_UNREADABLE",
    ],
    ["draft never shows up", { saveNothing: true }, "DRAFT_NOT_SAVED"],
    ["saved draft differs", { dropAttachments: 1 }, "DRAFT_MISMATCH"],
    ["osascript killed mid-script", { killCreate: true }, "MAIL_TIMEOUT"],
    ["close after save fails", { closeFails: true }, undefined],
    [
      "nothing saved and the close failed",
      { saveNothing: true, closeFails: true },
      "DRAFT_NOT_SAVED",
    ],
  ];
  for (const [name, opts, code] of paths) {
    it(`${name}: ${code ?? "OK"}, no compose window left`, async () => {
      const { mail, err } = await run(opts);
      expect(err?.code).toBe(code);
      expect(mail.outgoing).toEqual([]);
    });
  }

  it("closes a leftover by id only when the script could not", async () => {
    const ok = await run({});
    expect(ok.mail.calls("discard-outgoing")).toEqual([]);
    const killed = await run({ killCreate: true });
    expect(killed.mail.calls("discard-outgoing")).toEqual([
      { script: "discard-outgoing", argv: ["500"] },
    ]);
  });

  it("never touches the user's own compose windows, even with the same subject", async () => {
    const mine = [
      { id: "7", subject: "Q3 notes" },
      { id: "8", subject: "Other" },
    ];
    for (const opts of [{}, { killCreate: true }, { closeFails: true }]) {
      const { mail } = await run({ ...opts, outgoing: mine });
      expect(mail.outgoing).toEqual(mine);
      for (const c of mail.calls("discard-outgoing")) {
        expect(c.argv).not.toContain("7");
        expect(c.argv).not.toContain("8");
      }
    }
  });

  it("reports COMPOSE_LEFT_OPEN when the window cannot be closed after a save", async () => {
    const { mail, err } = await run({ closeFails: true, stuckOutgoing: true });
    expect(err?.code).toBe("COMPOSE_LEFT_OPEN");
    expect(helpOf(err!).join(" ")).toContain("Don't Save");
    expect(mail.calls("create-draft")).toHaveLength(1);
  });

  it("keeps the original error code and adds the close step when a failure also leaves a window", async () => {
    const { err } = await run({ killCreate: true, stuckOutgoing: true });
    expect(err?.code).toBe("MAIL_TIMEOUT");
    expect(helpOf(err!).join(" ")).toContain("Don't Save");
  });

  it("checks outgoing before and after the script, around create only", async () => {
    const { mail } = await run({ drafts: [draft("1")] });
    const scripts = mail.requests.map((r) => r.script);
    const at = scripts.indexOf("create-draft");
    expect(scripts[at - 1]).toBe("list-outgoing");
    expect(scripts[at + 1]).toBe("list-outgoing");
  });
});

describe("osa/create-draft.applescript follows the confirmed path", () => {
  const text = readFileSync(
    join(import.meta.dirname, "..", "osa", "create-draft.applescript"),
    "utf-8",
  );
  const code = text
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");

  it("composes visibly, never hidden", () => {
    expect(code).toMatch(/make new outgoing message[^\n]*visible:true/);
    expect(code).not.toMatch(/visible:false/);
  });

  it("closes its own message without saving, on the error path and after save", () => {
    expect(code).toMatch(/close theMessage saving no/);
    const handler = code.slice(code.indexOf("on error errText number errNum"));
    expect(handler).toMatch(
      /my discardMessage\(draftMessage\)\s+error errText number errNum/,
    );
    const afterSave = code.slice(code.lastIndexOf("save draftMessage"));
    expect(afterSave).toMatch(/my discardMessage\(draftMessage\)/);
  });

  it("raises every error after the message is made inside the cleanup try block", () => {
    const made = code.indexOf("make new outgoing message");
    const tryAt = code.lastIndexOf("\ttry\n\t\ttell application", made);
    const handlerAt = code.indexOf("on error errText number errNum");
    expect(tryAt).toBeGreaterThan(-1);
    expect(tryAt).toBeLessThan(made);
    const between = code.slice(handlerAt);
    // No `error "AMA_ERR...` is raised after the cleanup handler.
    expect(between.match(/error "AMA_ERR/g) ?? []).toEqual([]);
  });

  it("avoids the reserved words that broke the live probes", () => {
    expect(code).not.toMatch(/\bset left\b|\bwith ref\b/);
  });
});
