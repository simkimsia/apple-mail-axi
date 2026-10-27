import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AxiError,
  mailTimeoutError,
  mapOsascriptError,
  UNKNOWN_SUGGESTION,
  unsupportedPlatformError,
} from "./errors.js";

/**
 * The bundled scripts in `osa/`. Each one takes every value through argv
 * (`on run argv` / `function run(argv)`); no value is ever spliced into
 * script text, so the script files are fixed and can be audited
 * (test/no-send.test.ts).
 */
export const SCRIPTS = {
  preflight: { file: "preflight.js", language: "JavaScript" },
  "create-draft": { file: "create-draft.applescript", language: "AppleScript" },
  "list-drafts": { file: "list-drafts.js", language: "JavaScript" },
  "view-draft": { file: "view-draft.js", language: "JavaScript" },
  "delete-draft": { file: "delete-draft.js", language: "JavaScript" },
} as const;

export type ScriptName = keyof typeof SCRIPTS;

export interface OsaRequest {
  script: ScriptName;
  argv: string[];
}

export type OsaOutcome =
  | { kind: "ok"; stdout: string }
  | { kind: "exit"; exitCode: number; stderr: string }
  | { kind: "not-installed" }
  | { kind: "timeout" };

/** Injectable seam: tests replace this; nothing else runs osascript. */
export type OsaRunner = (request: OsaRequest) => Promise<OsaOutcome>;

const TIMEOUT_MS = 120_000;
const MAX_BUFFER_BYTES = 20 * 1024 * 1024;

/** Directory holding the bundled scripts, from src/ (tsx) or dist/src/. */
export function osaDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const candidate of [
    join(here, "..", "..", "osa"),
    join(here, "..", "..", "..", "osa"),
  ]) {
    if (existsSync(join(candidate, SCRIPTS.preflight.file))) return candidate;
  }
  throw new AxiError(
    "Bundled Mail scripts (osa/) are missing from this install",
    "UNKNOWN",
    ["Reinstall: `pnpm add -g @simkimsia/apple-mail-axi`"],
  );
}

/** The exact argv handed to osascript. The script path always precedes values,
 * so a value that starts with `-` can never be read as an osascript flag. */
export function osascriptArgv(request: OsaRequest, dir = osaDir()): string[] {
  const script = SCRIPTS[request.script];
  return ["-l", script.language, join(dir, script.file), ...request.argv];
}

function shellQuote(token: string): string {
  if (/^[\w@%+=:,./-]+$/.test(token)) return token;
  return `'${token.replace(/'/g, `'\\''`)}'`;
}

/** `AXI_DEBUG=1` line. Bodies can be long or private, so cap each value. */
export function debugLine(argv: string[]): string {
  const shown = argv.map((t) => (t.length > 80 ? `${t.slice(0, 80)}…` : t));
  return `[axi-debug] osascript ${shown.map(shellQuote).join(" ")}`;
}

export const defaultRunner: OsaRunner = (request) => {
  const argv = osascriptArgv(request);
  if (process.env.AXI_DEBUG === "1") {
    process.stderr.write(`${debugLine(argv)}\n`);
  }
  return new Promise((resolve) => {
    execFile(
      "osascript",
      argv,
      { timeout: TIMEOUT_MS, maxBuffer: MAX_BUFFER_BYTES },
      (error, stdout, stderr) => {
        if (!error) {
          resolve({ kind: "ok", stdout: String(stdout ?? "") });
          return;
        }
        const err = error as Error & {
          code?: string | number;
          killed?: boolean;
        };
        if (err.code === "ENOENT") resolve({ kind: "not-installed" });
        else if (err.killed) resolve({ kind: "timeout" });
        else
          resolve({
            kind: "exit",
            exitCode: typeof err.code === "number" ? err.code : 1,
            stderr: String(stderr ?? ""),
          });
      },
    );
  });
};

/** Run a bundled script and return its stdout, or throw a mapped AxiError. */
export async function runScript(
  runner: OsaRunner,
  request: OsaRequest,
  ctx: { id?: string } = {},
): Promise<string> {
  const outcome = await runner(request);
  switch (outcome.kind) {
    case "ok":
      return outcome.stdout;
    case "not-installed":
      throw unsupportedPlatformError();
    case "timeout":
      throw mailTimeoutError();
    case "exit":
      throw mapOsascriptError(outcome.stderr, ctx);
  }
}

/** Run a JXA script that returns JSON. */
export async function runJson<T>(
  runner: OsaRunner,
  request: OsaRequest,
  ctx: { id?: string } = {},
): Promise<T> {
  const stdout = await runScript(runner, request, ctx);
  try {
    return JSON.parse(stdout) as T;
  } catch {
    // Never echo stdout: it may hold draft content.
    throw new AxiError(
      `Unexpected output from the ${request.script} Mail script`,
      "UNKNOWN",
      [UNKNOWN_SUGGESTION],
    );
  }
}
