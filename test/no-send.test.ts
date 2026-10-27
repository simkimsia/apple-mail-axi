/**
 * Guard for VISION.md Scope: nothing in this package can hand a message to
 * Mail's outbox. Every script Mail runs is a bundled file in osa/, so
 * scanning those files (and proving no script text lives anywhere else) is
 * enough. Comments count too: rewording is cheaper than an exception.
 *
 * This is declared policy lint over the shipped script and source files,
 * not a behavioural test: AppleScript and JXA cannot run offline in CI. The
 * live smoke test (test/live.smoke.test.ts) is the behavioural proof.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SCRIPTS } from "../src/core/runner.js";

const ROOT = join(import.meta.dirname, "..");
const OSA = join(ROOT, "osa");

const FORBIDDEN: [string, RegExp][] = [
  // `sender` (the From property) is the one allowed word that starts with "send".
  ["send", /\bsend(?!er\b)/i],
  ["outbox", /out\s*box/i],
  ["outgoing message delivery", /\bdeliver/i],
  ["shell escape", /do shell script|doShellScript/i],
  ["redirect / forward / reply", /\b(redirect|forward|reply)\b/i],
];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe("no-send guard patterns", () => {
  const catches = (text: string) =>
    FORBIDDEN.some(([, pattern]) => pattern.test(text));
  for (const text of [
    "send draftMessage",
    'tell application "Mail" to send theMessage',
    "Mail.send(msg)",
    "msg.send()",
    "move m to outbox",
    "set mailbox of m to out box",
    'do shell script "x"',
    "make new outgoing message with properties {forward:true}",
  ]) {
    it(`flags ${JSON.stringify(text)}`, () => expect(catches(text)).toBe(true));
  }
  for (const text of [
    "set sender of draftMessage to theSender",
    "m.sender()",
    "m.dateSent()",
  ]) {
    it(`allows ${JSON.stringify(text)}`, () =>
      expect(catches(text)).toBe(false));
  }
});

describe("policy lint: no-send guard over osa/ and src/", () => {
  const files = readdirSync(OSA);

  it("ships exactly the scripts the runner knows", () => {
    expect(files.sort()).toEqual(
      Object.values(SCRIPTS)
        .map((s) => s.file)
        .sort(),
    );
  });

  for (const file of files) {
    for (const [label, pattern] of FORBIDDEN) {
      it(`osa/${file} contains no ${label}`, () => {
        const text = readFileSync(join(OSA, file), "utf-8");
        expect(text).not.toMatch(pattern);
      });
    }
  }

  it("takes every value through argv", () => {
    for (const file of files) {
      const text = readFileSync(join(OSA, file), "utf-8");
      expect(text).toMatch(
        file.endsWith(".js") ? /function run\(argv\)/ : /on run argv/,
      );
    }
  });

  it("keeps all script text in osa/: no inline AppleScript or JXA in src/", () => {
    for (const file of walk(join(ROOT, "src"))) {
      const text = readFileSync(file, "utf-8");
      expect(text, file).not.toMatch(/tell application|Application\("Mail"\)/);
      expect(text, file).not.toMatch(/["'`]-e["'`]/);
    }
  });

  it("spawns osascript from exactly one module", () => {
    const spawners = walk(join(ROOT, "src")).filter((f) =>
      /node:child_process/.test(readFileSync(f, "utf-8")),
    );
    expect(spawners.map((f) => f.slice(ROOT.length + 1))).toEqual([
      "src/core/runner.ts",
    ]);
  });
});
