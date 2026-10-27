/**
 * LIVE smoke test against the real Mail.app. Skipped unless
 * APPLE_MAIL_AXI_LIVE=1. It creates one draft with an attachment, reads it
 * back, then deletes it. It never sends. Run only with the user's approval:
 *
 *   APPLE_MAIL_AXI_LIVE=1 pnpm vitest run test/live.smoke.test.ts
 *
 * Optional: APPLE_MAIL_AXI_LIVE_TO (recipient, default a reserved
 * example.com address), APPLE_MAIL_AXI_LIVE_FROM (sender account).
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createDraft,
  deleteDraft,
  listDrafts,
  viewDraft,
} from "../src/core/drafts.js";

const LIVE = process.env.APPLE_MAIL_AXI_LIVE === "1";

describe.skipIf(!LIVE)("live Mail.app smoke (APPLE_MAIL_AXI_LIVE=1)", () => {
  it("creates, verifies, views and deletes one draft", async () => {
    const dir = mkdtempSync(join(tmpdir(), "apple-mail-axi-smoke-"));
    const file = join(dir, "smoke.txt");
    writeFileSync(file, "apple-mail-axi smoke attachment\n");
    const subject = `apple-mail-axi-smoke ${new Date().toISOString()}`;

    const created = await createDraft({
      to: [process.env.APPLE_MAIL_AXI_LIVE_TO ?? "smoke@example.com"],
      subject,
      body: "apple-mail-axi live smoke test. Safe to delete.",
      attach: [file],
      from: process.env.APPLE_MAIL_AXI_LIVE_FROM,
    });
    const id = created.draft.id;
    try {
      expect(created.draft.attachments).toHaveLength(1);
      const listed = await listDrafts({ limit: 500 });
      expect(listed.drafts.map((d) => d.id)).toContain(id);
      const viewed = await viewDraft({ id });
      expect(viewed.draft.subject).toBe(subject);
    } finally {
      await deleteDraft({ id });
    }
  }, 120_000);
});
