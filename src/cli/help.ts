import { OPERATIONS, type OperationSpec } from "../core/operations.js";

function usage(op: OperationSpec): string {
  const parts = op.params.map((p) => {
    if (p.positional) return p.cli;
    const value =
      p.kind === "boolean" ? "" : p.kind === "integer" ? " <n>" : " <value>";
    const flag = `${p.cli}${value}`;
    return p.required ? flag : `[${flag}]`;
  });
  return `apple-mail-axi ${op.cli.join(" ")} ${parts.join(" ")}`.trimEnd();
}

/** Per-operation reference, generated from the shared spec. */
export function operationHelp(op: OperationSpec): string {
  const lines = [`usage: ${usage(op)}`, op.summary];
  if (op.params.length > 0) {
    lines.push(`args[${op.params.length}]:`);
    for (const p of op.params) {
      lines.push(
        `  ${p.cli.padEnd(12)} ${p.description}${p.kind === "string[]" ? " (repeatable)" : ""}`,
      );
    }
  }
  return lines.join("\n");
}

export const DRAFT_HELP = `${OPERATIONS.map(operationHelp).join("\n\n")}
examples:
  apple-mail-axi draft create --to ana@example.com --subject "Q3 notes" --body "Hi Ana" --attach ./notes.pdf
  printf 'Long body' | apple-mail-axi draft create --to ana@example.com --subject "Q3" --body-file -
  apple-mail-axi draft list --limit 20
  apple-mail-axi draft view 48213
  apple-mail-axi draft delete 48213
`;

export const MCP_HELP = `usage: apple-mail-axi mcp
Run the stdio MCP server. It exposes the same operations as the CLI, as tools:
tools[${OPERATIONS.length}]:
${OPERATIONS.map((o) => `  ${o.name} = apple-mail-axi ${o.cli.join(" ")}`).join("\n")}
Client config (Claude Code): claude mcp add apple-mail -- apple-mail-axi mcp
`;

export const TOP_HELP = `usage: apple-mail-axi [command] [flags]
commands[${OPERATIONS.length + 2}]:
  (none)=recent drafts
${OPERATIONS.map((o) => `  ${o.cli.join(" ")}`).join("\n")}
  mcp = stdio MCP server with the same operations
flags[2]:
  --help, -v/-V/--version
never: sends mail, touches the outbox, or reads or changes non-draft mail
examples:
  apple-mail-axi
  apple-mail-axi draft create --to ana@example.com --subject "Hi" --body "..."
  apple-mail-axi draft list
  apple-mail-axi draft --help
`;
