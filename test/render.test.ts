import { describe, expect, it } from "vitest";
import { BODY_PREVIEW, renderCreate, renderView } from "../src/render.js";
import { draft } from "./fake-mail.js";

describe("renderView", () => {
  const long = draft("4", { body: "x".repeat(BODY_PREVIEW + 500) });

  it("truncates a long body, states its size, and offers --full", () => {
    const out = renderView({ draft: long, full: false });
    expect(out).toContain(`(truncated, ${BODY_PREVIEW + 500} chars total)`);
    expect(out).toContain("draft view 4 --full");
  });

  it("shows the whole body with --full and no hint", () => {
    const out = renderView({ draft: long, full: true });
    expect(out).not.toContain("truncated");
    expect(out).not.toContain("--full");
  });
});

describe("renderCreate", () => {
  it("says what changed, that it was verified, and that nothing was sent", () => {
    const out = renderCreate({
      draft: draft("9", { attachments: [{ name: "a.pdf", size: 1 }] }),
      verifiedAfterMs: 0,
    });
    expect(out).toContain('id: "9"');
    expect(out).toContain("1 attachment(s) read back from Mail");
    expect(out).toContain("sent: false");
  });
});
