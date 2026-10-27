import { AxiError as SdkAxiError, runAxiCli } from "axi-sdk-js";
import {
  AxiError,
  exitCodeForError,
  validationError,
  type ErrorCode,
} from "./core/errors.js";
import { defaultDeps, listDrafts, type CoreDeps } from "./core/drafts.js";
import { OPERATIONS } from "./core/operations.js";
import { DRAFT_HELP, MCP_HELP, TOP_HELP } from "./cli/help.js";
import { parseCli } from "./cli/parse.js";
import { draftRows, RENDERERS, renderError } from "./render.js";
import { toAxiError } from "./invoke.js";
import { encode, renderHelp, renderList, renderOutput } from "./toon.js";
import { VERSION } from "./version.js";

export const DESCRIPTION =
  "Agent-first CLI for Apple Mail drafts on macOS: create, list, view and delete plain-text drafts with attachments, verified after save. Never sends mail.";

export interface MainOptions {
  argv?: string[];
  stdout?: { write: (chunk: string) => unknown };
  deps?: CoreDeps;
  readStdin?: () => Promise<string>;
}

async function readAllStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf-8");
}

const HOME_LIMIT = 5;

/** Mail-state failures the home view reports as state instead of exiting 1. */
const DEGRADE: ErrorCode[] = [
  "AUTOMATION_DENIED",
  "MAIL_NOT_RUNNING",
  "MAIL_NOT_SET_UP",
  "MAIL_TIMEOUT",
  "UNSUPPORTED_PLATFORM",
];

export async function homeView(deps: CoreDeps): Promise<string> {
  try {
    const r = await listDrafts({ limit: HOME_LIMIT }, deps);
    if (r.total === 0) {
      return renderOutput([
        "drafts: 0 drafts in Mail's Drafts mailbox",
        renderHelp([
          'Run `apple-mail-axi draft create --to <address> --subject "<subject>" --body "<text>"` to save one',
        ]),
      ]);
    }
    return renderOutput([
      `count: ${r.drafts.length} of ${r.total} drafts (newest first)`,
      renderList("drafts", draftRows(r.drafts)),
      renderHelp([
        "Run `apple-mail-axi draft view <id>` for one draft",
        ...(r.total > r.drafts.length
          ? ["Run `apple-mail-axi draft list` for more drafts"]
          : []),
      ]),
    ]);
  } catch (error) {
    if (error instanceof AxiError && DEGRADE.includes(error.code)) {
      return renderOutput([
        encode({
          drafts: {
            status: "unavailable",
            code: error.code,
            error: error.message,
          },
        }),
        renderHelp(error.suggestions),
      ]);
    }
    throw error;
  }
}

export async function main(options: MainOptions = {}): Promise<void> {
  const argv = options.argv ?? process.argv.slice(2);
  const deps = options.deps ?? defaultDeps();
  const readStdin = options.readStdin ?? readAllStdin;

  // The MCP server owns stdout as its transport, so it never runs inside
  // runAxiCli (which writes the command's output to stdout when it returns).
  if (argv.length === 1 && argv[0] === "mcp") {
    const { startMcpServer } = await import("./mcp/server.js");
    await startMcpServer(deps);
    return;
  }

  await runAxiCli({
    description: DESCRIPTION,
    version: VERSION,
    argv,
    stdout: options.stdout,
    topLevelHelp: TOP_HELP,
    home: () => homeView(deps),
    commands: {
      draft: async (args) => {
        const [sub, ...rest] = args;
        const op = OPERATIONS.find(
          (o) => o.cli[0] === "draft" && o.cli[1] === sub,
        );
        if (!op) {
          const subs = OPERATIONS.map((o) => o.cli[1]).join(", ");
          throw validationError(
            sub
              ? `unknown draft subcommand ${sub}`
              : "draft needs a subcommand",
            [`Use one of: ${subs}; run \`apple-mail-axi draft --help\``],
          );
        }
        const input = parseCli(op, rest);
        // `--body-file -` reads stdin; only the CLI has a stdin to read.
        if (input.bodyFile === "-") {
          delete input.bodyFile;
          if (input.body !== undefined) {
            throw validationError(
              "pass the body once: body or body file, not both",
              [
                'Use `--body "..."` for short text, or `--body-file <path>` (`--body-file -` reads stdin)',
              ],
            );
          }
          input.body = await readStdin();
        }
        const result = await op.run(input, deps);
        return RENDERERS[op.name](result as never);
      },
      mcp: (args) => {
        throw validationError(
          `\`mcp\` takes no arguments, got ${args[0] ?? "(none)"}`,
          ["Run `apple-mail-axi mcp` with no other arguments"],
        );
      },
    },
    getCommandHelp: (command) =>
      command === "draft"
        ? DRAFT_HELP
        : command === "mcp"
          ? MCP_HELP
          : undefined,
    // The SDK's default formatter only knows its own AxiError class; route
    // ours (and foreign throws) through the shared renderer (gh-axi pattern).
    formatError: (error) => {
      const axi =
        error instanceof SdkAxiError
          ? (error as unknown as AxiError)
          : toAxiError(error);
      return { output: renderError(axi), exitCode: exitCodeForError(axi) };
    },
  });
}
