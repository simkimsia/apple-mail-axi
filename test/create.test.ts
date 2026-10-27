import { describe, expect, it } from "vitest";
import { AxiError } from "../src/core/errors.js";
import {
  compareDraft,
  createDraft,
  type CreateDraftInput,
} from "../src/core/drafts.js";
import { draft, FakeMail, fakeDeps, fakeFs, helpOf } from "./fake-mail.js";

const files = fakeFs({ "/work/a.pdf": "file", "/work/b.png": "file" });

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return (e as AxiError).code;
  }
  return "OK";
}

const input: CreateDraftInput = {
  to: ["ana@example.com"],
  cc: ["cy@example.com"],
  bcc: ["bo@example.com"],
  subject: "Q3 notes",
  body: "Hi Ana",
  attach: ["a.pdf", "/work/b.png"],
};

describe("createDraft verification", () => {
  it("reports success only after reading back a matching draft", async () => {
    const mail = new FakeMail({ drafts: [draft("10")] });
    const r = await createDraft(input, fakeDeps(mail, files));
    expect(r.draft.id).toBe("9000");
    expect(r.draft.attachments).toHaveLength(2);
    expect(mail.requests.map((q) => q.script)).toEqual([
      "preflight",
      "list-outgoing",
      "create-draft",
      "list-outgoing",
      "list-drafts",
      "view-draft",
    ]);
  });

  it("resolves relative attachment paths against cwd before Mail sees them", async () => {
    const mail = new FakeMail();
    await createDraft(input, fakeDeps(mail, files));
    const argv = mail.calls("create-draft")[0].argv;
    expect(argv.slice(-3)).toEqual(["2", "/work/a.pdf", "/work/b.png"]);
  });

  it("keeps polling while attachments land late, then succeeds", async () => {
    const mail = new FakeMail({ attachmentsAfterViews: 2 });
    const r = await createDraft(input, fakeDeps(mail, files));
    expect(r.draft.attachments).toHaveLength(2);
    expect(mail.calls("view-draft")).toHaveLength(3);
    expect(r.verifiedAfterMs).toBe(2_000);
  });

  it("fails with DRAFT_MISMATCH when Mail dropped an attachment for good", async () => {
    const mail = new FakeMail({ dropAttachments: 1 });
    const err = await createDraft(input, fakeDeps(mail, files)).catch(
      (e) => e as AxiError,
    );
    expect(err).toBeInstanceOf(AxiError);
    expect(err.code).toBe("DRAFT_MISMATCH");
    expect(err.message).toContain("attachments 1 of 2");
    expect(helpOf(err).join(" ")).toContain("draft delete 9000");
  });

  it("fails with DRAFT_MISMATCH when a recipient field differs", async () => {
    const mail = new FakeMail({ dropBcc: true });
    const err = await createDraft(input, fakeDeps(mail, files)).catch(
      (e) => e as AxiError,
    );
    expect(err.code).toBe("DRAFT_MISMATCH");
    expect(err.message).toContain("bcc is [], wanted [bo@example.com]");
  });

  it("compares recipients case-insensitively and in any order", async () => {
    const mail = new FakeMail();
    const r = await createDraft(
      { ...input, to: ["Ana@Example.com", "zed@example.com"] },
      fakeDeps(mail, files),
    );
    expect(r.draft.to).toEqual(["Ana@Example.com", "zed@example.com"]);
  });

  it("fails with DRAFT_NOT_SAVED when no new draft ever shows up", async () => {
    const mail = new FakeMail({
      saveNothing: true,
      drafts: [draft("10", { subject: "Q3 notes" })],
    });
    expect(await codeOf(createDraft(input, fakeDeps(mail, files)))).toBe(
      "DRAFT_NOT_SAVED",
    );
  });

  it("ignores pre-existing drafts with the same subject", async () => {
    const mail = new FakeMail({
      drafts: [draft("10", { subject: "Q3 notes" })],
    });
    const r = await createDraft(input, fakeDeps(mail, files));
    expect(r.draft.id).toBe("9000");
  });
});

describe("createDraft validation happens before Mail is touched", () => {
  const cases: [string, CreateDraftInput, string][] = [
    ["missing subject", { to: ["a@x.example"] }, "VALIDATION_ERROR"],
    ["multi-line subject", { subject: "a\nb" }, "VALIDATION_ERROR"],
    [
      "bad address",
      { subject: "s", to: ["Ana <ana@x.example>"] },
      "VALIDATION_ERROR",
    ],
    [
      "body twice",
      { subject: "s", body: "x", bodyFile: "/b.txt" },
      "VALIDATION_ERROR",
    ],
    [
      "stdin body over MCP",
      { subject: "s", bodyFile: "-" },
      "VALIDATION_ERROR",
    ],
    [
      "unreadable body file",
      { subject: "s", bodyFile: "/missing.txt" },
      "VALIDATION_ERROR",
    ],
    [
      "missing attachment",
      { subject: "s", attach: ["/work/nope.pdf"] },
      "ATTACHMENT_NOT_FOUND",
    ],
    [
      "directory attachment",
      { subject: "s", attach: ["/work/dir"] },
      "ATTACHMENT_UNREADABLE",
    ],
    [
      "unreadable attachment",
      { subject: "s", attach: ["/work/secret"] },
      "ATTACHMENT_UNREADABLE",
    ],
  ];
  for (const [name, bad, code] of cases) {
    it(`${name} -> ${code}`, async () => {
      const mail = new FakeMail();
      const fs = fakeFs({
        "/work/dir": "directory",
        "/work/secret": "unreadable",
      });
      expect(await codeOf(createDraft(bad, fakeDeps(mail, fs)))).toBe(code);
      expect(mail.requests).toEqual([]);
    });
  }

  it("reads the body from a body file", async () => {
    const mail = new FakeMail();
    const fs = fakeFs({}, { "/work/body.txt": "from file\n" });
    const r = await createDraft(
      { subject: "s", bodyFile: "body.txt" },
      fakeDeps(mail, fs),
    );
    expect(r.draft.body).toBe("from file\n");
  });
});

describe("sender resolution", () => {
  it("maps an account name to its full name and first address", async () => {
    const mail = new FakeMail();
    await createDraft({ subject: "s", from: "work" }, fakeDeps(mail));
    expect(mail.calls("create-draft")[0].argv[2]).toBe(
      "Kim Sia <kim@work.example>",
    );
  });

  it("accepts any address of an account", async () => {
    const mail = new FakeMail();
    await createDraft({ subject: "s", from: "K@home.example" }, fakeDeps(mail));
    expect(mail.calls("create-draft")[0].argv[2]).toBe("k@home.example");
  });

  it("passes an empty sender when --from is left out (Mail's default)", async () => {
    const mail = new FakeMail();
    await createDraft({ subject: "s" }, fakeDeps(mail));
    expect(mail.calls("create-draft")[0].argv[2]).toBe("");
  });

  it("refuses an unknown sender with UNKNOWN_SENDER and lists the choices, before creating", async () => {
    const mail = new FakeMail();
    const err = await createDraft(
      { subject: "s", from: "nobody@x.example" },
      fakeDeps(mail),
    ).catch((e) => e as AxiError);
    expect(err.code).toBe("UNKNOWN_SENDER");
    expect(helpOf(err)[0]).toContain("Work: kim@work.example");
    expect(helpOf(err)[0]).not.toContain("old@old.example");
    expect(mail.calls("create-draft")).toEqual([]);
  });

  it("treats a disabled account as unknown", async () => {
    const mail = new FakeMail();
    expect(
      await codeOf(
        createDraft({ subject: "s", from: "old@old.example" }, fakeDeps(mail)),
      ),
    ).toBe("UNKNOWN_SENDER");
  });
});

describe("read-back is scoped to the sender account", () => {
  it("finds the draft in the sender account's Drafts", async () => {
    const mail = new FakeMail();
    const r = await createDraft({ subject: "s", from: "Home" }, fakeDeps(mail));
    expect(r.draft.account).toBe("Home");
  });

  it("ignores a same-subject draft that landed in another account", async () => {
    const mail = new FakeMail({ saveToAccount: "Home" });
    const err = await createDraft(
      { subject: "s", from: "Work" },
      fakeDeps(mail),
    ).catch((e) => e as AxiError);
    expect(err.code).toBe("DRAFT_NOT_SAVED");
    expect(err.message).toContain("the Work Drafts");
  });

  it("without a sender, any account's Drafts counts", async () => {
    const mail = new FakeMail({ saveToAccount: "Home" });
    const r = await createDraft({ subject: "s" }, fakeDeps(mail));
    expect(r.draft.account).toBe("Home");
  });

  it("checks the saved sender address when one was asked for", () => {
    const wanted = {
      to: [],
      cc: [],
      bcc: [],
      subject: "s",
      body: "",
      attach: [],
    };
    const saved = draft("1", { subject: "s", to: [], from: "x@other.example" });
    expect(compareDraft(wanted, saved, "kim@work.example")).toEqual([
      'from is "x@other.example", wanted "kim@work.example"',
    ]);
    expect(
      compareDraft(
        wanted,
        { ...saved, from: "Kim Sia <KIM@work.example>" },
        "kim@work.example",
      ),
    ).toEqual([]);
  });
});
