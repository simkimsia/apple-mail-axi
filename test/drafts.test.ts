import { describe, expect, it } from "vitest";
import { AxiError } from "../src/core/errors.js";
import { deleteDraft, listDrafts, viewDraft } from "../src/core/drafts.js";
import { draft, FakeMail, fakeDeps } from "./fake-mail.js";

describe("listDrafts", () => {
  it("returns newest first with the total", async () => {
    const mail = new FakeMail({
      drafts: [draft("5"), draft("12"), draft("7")],
    });
    const r = await listDrafts({ limit: 2 }, fakeDeps(mail));
    expect(r.total).toBe(3);
    expect(r.drafts.map((d) => d.id)).toEqual(["12", "7"]);
  });

  it("accepts the limit as a CLI string and clamps it", async () => {
    const mail = new FakeMail();
    await listDrafts({ limit: "9999" }, fakeDeps(mail));
    expect(mail.calls("list-drafts")[0].argv).toEqual(["rows", "500"]);
  });

  it("rejects a bad limit before calling Mail", async () => {
    const mail = new FakeMail();
    await expect(
      listDrafts({ limit: "0" }, fakeDeps(mail)),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    expect(mail.requests).toEqual([]);
  });
});

describe("viewDraft", () => {
  it("returns the draft for a full id", async () => {
    const mail = new FakeMail({ drafts: [draft("12")] });
    const r = await viewDraft({ id: "12" }, fakeDeps(mail));
    expect(r.draft.subject).toBe("Subject 12");
  });

  it("maps an id outside Drafts to DRAFT_NOT_FOUND", async () => {
    const mail = new FakeMail({ drafts: [draft("12")] });
    await expect(viewDraft({ id: "13" }, fakeDeps(mail))).rejects.toMatchObject(
      {
        code: "DRAFT_NOT_FOUND",
        message: expect.stringContaining("13"),
      },
    );
  });
});

describe("deleteDraft", () => {
  it("deletes and confirms the id left Drafts", async () => {
    const mail = new FakeMail({ drafts: [draft("12"), draft("13")] });
    const r = await deleteDraft({ id: "12" }, fakeDeps(mail));
    expect(r).toEqual({ id: "12", subject: "Subject 12", account: "Work" });
    expect(mail.drafts.map((d) => d.id)).toEqual(["13"]);
  });

  for (const bad of ["", "1*", "12 ", "0x1f", "-1", "12,13"]) {
    it(`refuses ${JSON.stringify(bad)} without calling Mail`, async () => {
      const mail = new FakeMail({ drafts: [draft("12")] });
      await expect(
        deleteDraft({ id: bad }, fakeDeps(mail)),
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
      });
      expect(mail.requests).toEqual([]);
    });
  }

  it("refuses an id that is not in Drafts", async () => {
    const mail = new FakeMail({ drafts: [draft("12")] });
    await expect(
      deleteDraft({ id: "1" }, fakeDeps(mail)),
    ).rejects.toMatchObject({
      code: "DRAFT_NOT_FOUND",
    });
    expect(mail.drafts).toHaveLength(1);
  });

  it("does not report success while the draft is still listed", async () => {
    const mail = new FakeMail({ drafts: [draft("12")], deleteNoop: true });
    const err = await deleteDraft({ id: "12" }, fakeDeps(mail)).catch(
      (e) => e as AxiError,
    );
    expect(err.code).toBe("DELETE_NOT_CONFIRMED");
  });
});
