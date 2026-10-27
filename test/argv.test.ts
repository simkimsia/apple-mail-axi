import { describe, expect, it } from "vitest";
import {
  buildCreateArgv,
  settleMs,
  type NormalizedCreate,
} from "../src/core/drafts.js";
import { debugLine, osascriptArgv } from "../src/core/runner.js";

const base: NormalizedCreate = {
  to: ["a@x.example", "b@x.example"],
  cc: [],
  bcc: ["c@x.example"],
  subject: 'Q3 "notes"; tell application "Finder"',
  body: "line 1\nline 2\n-- not a comment",
  attach: ["/tmp/a.pdf"],
};

describe("buildCreateArgv", () => {
  it("lays values out as counted lists, matching osa/create-draft.applescript", () => {
    expect(buildCreateArgv(base, "Kim <kim@work.example>")).toEqual([
      base.subject,
      base.body,
      "Kim <kim@work.example>",
      String(settleMs(1)),
      "2",
      "a@x.example",
      "b@x.example",
      "0",
      "1",
      "c@x.example",
      "1",
      "/tmp/a.pdf",
    ]);
  });

  it("passes hostile text through verbatim as single argv items", () => {
    const argv = buildCreateArgv(base, "");
    expect(argv[0]).toBe(base.subject);
    expect(argv[1]).toBe(base.body);
    expect(argv[2]).toBe("");
  });

  it("gives Mail no settle time without attachments and a capped one with them", () => {
    expect(settleMs(0)).toBe(0);
    expect(settleMs(1)).toBe(3_000);
    expect(settleMs(20)).toBe(15_000);
  });
});

describe("osascriptArgv", () => {
  it("puts the language and script path before every value", () => {
    const argv = osascriptArgv(
      { script: "create-draft", argv: ["-e", "--help"] },
      "/pkg/osa",
    );
    expect(argv).toEqual([
      "-l",
      "AppleScript",
      "/pkg/osa/create-draft.applescript",
      "-e",
      "--help",
    ]);
  });

  it("runs the JXA scripts as JavaScript", () => {
    expect(
      osascriptArgv({ script: "view-draft", argv: ["12"] }, "/o").slice(0, 3),
    ).toEqual(["-l", "JavaScript", "/o/view-draft.js"]);
  });

  it("finds the real bundled osa directory from source", () => {
    expect(osascriptArgv({ script: "preflight", argv: [] })[2]).toMatch(
      /osa\/preflight\.js$/,
    );
  });
});

describe("debugLine", () => {
  it("quotes tokens and caps long values", () => {
    const line = debugLine(["-l", "JavaScript", "it's", "x".repeat(200)]);
    expect(line).toContain("'it'\\''s'");
    expect(line).toContain(`${"x".repeat(80)}…`);
    expect(line).not.toContain("x".repeat(81));
  });
});
