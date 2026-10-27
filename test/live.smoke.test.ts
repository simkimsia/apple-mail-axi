/**
 * LIVE smoke test against the real Mail.app. Skipped unless
 * APPLE_MAIL_AXI_LIVE=1. It creates one draft with an attachment, reads it
 * back, then deletes it, and checks that no compose window (outgoing
 * message) of its own is left open. It never sends. Run only with the
 * user's approval:
 *
 *   APPLE_MAIL_AXI_LIVE=1 pnpm vitest run test/live.smoke.test.ts
 *
 * A compose window appears on screen for a few seconds during the create.
 *
 * Optional: APPLE_MAIL_AXI_LIVE_FROM (sender account name or address,
 * default "iCloud", the account the 2026-10-27 probes confirmed),
 * APPLE_MAIL_AXI_LIVE_TO (recipient, default a reserved example.com address).
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
import { defaultRunner, runJson } from "../src/core/runner.js";

const LIVE = process.env.APPLE_MAIL_AXI_LIVE === "1";
const FROM = process.env.APPLE_MAIL_AXI_LIVE_FROM ?? "iCloud";

async function outgoing(): Promise<{ id: string; subject: string }[]> {
  const out = await runJson<{ outgoing: { id: string; subject: string }[] }>(
    defaultRunner,
    { script: "list-outgoing", argv: [] },
  );
  return out.outgoing;
}

describe.skipIf(!LIVE)("live Mail.app smoke (APPLE_MAIL_AXI_LIVE=1)", () => {
  it(`creates from ${FROM}, verifies, views and deletes one draft, leaving no compose window`, async () => {
    const dir = mkdtempSync(join(tmpdir(), "apple-mail-axi-smoke-"));
    const file = join(dir, "smoke.txt");
    writeFileSync(file, "apple-mail-axi smoke attachment\n");
    const subject = `apple-mail-axi-smoke ${new Date().toISOString()}`;
    const openBefore = new Set((await outgoing()).map((o) => o.id));

    let id: string | undefined;
    try {
      const created = await createDraft({
        to: [process.env.APPLE_MAIL_AXI_LIVE_TO ?? "smoke@example.com"],
        subject,
        body: "apple-mail-axi live smoke test. Safe to delete.",
        attach: [file],
        from: FROM,
      });
      id = created.draft.id;
      expect(created.draft.attachments).toHaveLength(1);
      const listed = await listDrafts({ limit: 500 });
      expect(listed.drafts.map((d) => d.id)).toContain(id);
      const viewed = await viewDraft({ id });
      expect(viewed.draft.subject).toBe(subject);
    } finally {
      // Checked on success and failure alike.
      const leftover = (await outgoing()).filter(
        (o) => !openBefore.has(o.id) || o.subject === subject,
      );
      if (id !== undefined) await deleteDraft({ id });
      expect(leftover).toEqual([]);
    }
  }, 120_000);
});
