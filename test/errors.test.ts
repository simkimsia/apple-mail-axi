import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { mapOsascriptError } from "../src/core/errors.js";
import { listDrafts, createDraft } from "../src/core/drafts.js";
import { FakeMail, fakeDeps, helpOf } from "./fake-mail.js";

/**
 * osascript stderr fixtures, labelled by where they come from.
 *
 * - CONFIRMED_PATH: live run 1 (2026-10-27, macOS Darwin 24.6.0) took this
 *   path end to end: with Mail closed, the script threw our marker and the
 *   CLI printed MAIL_NOT_RUNNING with the VISION fix. The stderr text itself
 *   was not recorded verbatim, so the line below is still shaped by hand.
 * - GUESSED: shaped after osascript's "<path>: execution error: <msg> (<n>)"
 *   format and Apple's documented error numbers, never observed here. The
 *   Automation denial in particular was not seen: the prompt appeared on the
 *   first real call and was granted.
 *
 * Replace any line with a verbatim capture when a live run produces one, and
 * change its label to VERBATIM with the date.
 */
type Source = "CONFIRMED_PATH" | "GUESSED";
const FIXTURES: Record<string, { source: Source; stderr: string }> = {
  automation: {
    source: "GUESSED",
    stderr:
      "/pkg/osa/preflight.js: execution error: Error: Not authorized to send Apple events to Mail. (-1743)\n",
  },
  notRunningMarker: {
    source: "CONFIRMED_PATH",
    stderr:
      "/pkg/osa/preflight.js: execution error: Error: AMA_ERR:MAIL_NOT_RUNNING (-2700)\n",
  },
  notRunningAppleScript: {
    source: "GUESSED",
    stderr:
      "/pkg/osa/create-draft.applescript: execution error: AMA_ERR:MAIL_NOT_RUNNING (9001)\n",
  },
  notSetUp: {
    source: "GUESSED",
    stderr:
      "/pkg/osa/preflight.js: execution error: Error: AMA_ERR:MAIL_NOT_SET_UP (-2700)\n",
  },
  procNotFound: {
    source: "GUESSED",
    stderr:
      "/pkg/osa/view-draft.js: execution error: Error: Application isn't running. (-600)\n",
  },
  timeout: {
    source: "GUESSED",
    stderr:
      "/pkg/osa/list-drafts.js: execution error: Error: AppleEvent timed out. (-1712)\n",
  },
  rejected: {
    source: "GUESSED",
    stderr:
      "/pkg/osa/create-draft.applescript: execution error: AMA_ERR:ATTACHMENT_REJECTED:/x/a.pdf (9003)\n",
  },
  draftMissing: {
    source: "GUESSED",
    stderr:
      "/pkg/osa/view-draft.js: execution error: Error: AMA_ERR:DRAFT_NOT_FOUND:42 (-2700)\n",
  },
  other: {
    source: "GUESSED",
    stderr:
      "/pkg/osa/view-draft.js: execution error: Error: Something odd happened (-10000)\n",
  },
};
const STDERR = Object.fromEntries(
  Object.entries(FIXTURES).map(([k, v]) => [k, v.stderr]),
) as Record<keyof typeof FIXTURES, string>;

describe("mapOsascriptError", () => {
  const cases: [string, string, RegExp][] = [
    ["automation", "AUTOMATION_DENIED", /Privacy & Security → Automation/],
    ["notRunningMarker", "MAIL_NOT_RUNNING", /open -a Mail/],
    ["notRunningAppleScript", "MAIL_NOT_RUNNING", /open -a Mail/],
    ["notSetUp", "MAIL_NOT_SET_UP", /Settings > Accounts/],
    ["procNotFound", "MAIL_NOT_RUNNING", /open -a Mail/],
    ["timeout", "MAIL_TIMEOUT", /draft list/],
    ["rejected", "ATTACHMENT_UNREADABLE", /copy it/],
    ["draftMissing", "DRAFT_NOT_FOUND", /draft list/],
    ["other", "UNKNOWN", /AXI_DEBUG=1/],
  ];
  for (const [fixture, code, help] of cases) {
    it(`${fixture} (${FIXTURES[fixture].source}) -> ${code} with a next step`, () => {
      const err = mapOsascriptError(STDERR[fixture]);
      expect(err.code).toBe(code);
      expect(helpOf(err).join("\n")).toMatch(help);
    });
  }

  it("relays one stripped stderr line for unknown failures", () => {
    expect(mapOsascriptError(STDERR.other).message).toBe(
      "Mail script failed: Something odd happened (-10000)",
    );
  });

  it("names the requested id for DRAFT_NOT_FOUND", () => {
    expect(
      mapOsascriptError(STDERR.draftMissing, { id: "42" }).message,
    ).toContain("id 42");
  });
});

describe("runner outcomes map to errors", () => {
  it("a missing osascript binary is UNSUPPORTED_PLATFORM", async () => {
    const mail = new FakeMail({ fail: { kind: "not-installed" } });
    await expect(listDrafts({}, fakeDeps(mail))).rejects.toMatchObject({
      code: "UNSUPPORTED_PLATFORM",
    });
  });

  it("a killed osascript is MAIL_TIMEOUT", async () => {
    const mail = new FakeMail({ fail: { kind: "timeout" } });
    await expect(listDrafts({}, fakeDeps(mail))).rejects.toMatchObject({
      code: "MAIL_TIMEOUT",
    });
  });

  it("non-JSON stdout is UNKNOWN and never echoed", async () => {
    const mail = new FakeMail({
      fail: { kind: "ok", stdout: "secret draft body" },
    });
    const err = await listDrafts({}, fakeDeps(mail)).catch((e) => e);
    expect(err.code).toBe("UNKNOWN");
    expect(err.message).not.toContain("secret");
  });

  it("a permission failure in preflight stops create before anything is saved", async () => {
    const mail = new FakeMail({
      fail: { kind: "exit", exitCode: 1, stderr: STDERR.automation },
    });
    await expect(
      createDraft({ subject: "s" }, fakeDeps(mail)),
    ).rejects.toMatchObject({
      code: "AUTOMATION_DENIED",
    });
    expect(mail.requests.map((r) => r.script)).toEqual(["preflight"]);
  });
});

describe("VISION.md error table", () => {
  const vision = readFileSync(
    join(import.meta.dirname, "..", "VISION.md"),
    "utf-8",
  );
  const fixFor = (row: string) => {
    const line = vision.split("\n").find((l) => l.startsWith(`| ${row}`));
    if (!line) throw new Error(`VISION.md has no row for ${row}`);
    return line.split("|")[2].trim();
  };

  it("Automation error prints the VISION fix verbatim", () => {
    const err = mapOsascriptError(STDERR.automation);
    for (const t of ["cli", "mcp"] as const) {
      expect(helpOf(err, t)).toContain(fixFor("Missing Automation permission"));
    }
  });

  it("Mail-not-running error prints the VISION fix", () => {
    const err = mapOsascriptError(STDERR.notRunningMarker);
    for (const t of ["cli", "mcp"] as const) {
      expect(helpOf(err, t).join(" ")).toContain(
        fixFor("Mail.app not running"),
      );
    }
  });
});
