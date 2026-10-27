import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { defaultDeps, type CoreDeps } from "../core/drafts.js";
import {
  OPERATIONS,
  type OperationSpec,
  type ParamSpec,
} from "../core/operations.js";
import { invoke } from "../invoke.js";
import { VERSION } from "../version.js";

/**
 * Every field is optional in the schema on purpose: required-ness and value
 * checks live in the core, so a missing subject gets the same
 * VALIDATION_ERROR here as on the CLI instead of a transport-level error.
 */
function zodFor(p: ParamSpec): z.ZodTypeAny {
  const base =
    p.kind === "string[]"
      ? z.array(z.string())
      : p.kind === "boolean"
        ? z.boolean()
        : p.kind === "integer"
          ? z.number().int()
          : z.string();
  const note = p.required ? " (required)" : "";
  return base.optional().describe(`${p.description}${note}`);
}

export function toolShape(op: OperationSpec): Record<string, z.ZodTypeAny> {
  return Object.fromEntries(op.params.map((p) => [p.mcp, zodFor(p)]));
}

/** Map MCP argument names to core input keys. */
export function toCoreInput(
  op: OperationSpec,
  args: Record<string, unknown>,
): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  for (const p of op.params) {
    if (args[p.mcp] !== undefined) input[p.key] = args[p.mcp];
  }
  return input;
}

export function buildMcpServer(deps: CoreDeps = defaultDeps()): McpServer {
  const server = new McpServer({ name: "apple-mail-axi", version: VERSION });
  for (const op of OPERATIONS) {
    server.registerTool(
      op.name,
      {
        description: `${op.summary} Same as \`apple-mail-axi ${op.cli.join(" ")}\`.`,
        inputSchema: toolShape(op),
        annotations: {
          readOnlyHint: !op.write,
          destructiveHint: op.name === "draft_delete",
          openWorldHint: false,
        },
      },
      async (args: Record<string, unknown>) => {
        const result = await invoke(op.name, toCoreInput(op, args), deps);
        return {
          content: [{ type: "text" as const, text: result.text }],
          ...(result.isError ? { isError: true } : {}),
        };
      },
    );
  }
  return server;
}

export async function startMcpServer(
  deps: CoreDeps = defaultDeps(),
): Promise<void> {
  const server = buildMcpServer(deps);
  await server.connect(new StdioServerTransport());
  // Keep running until the client closes stdin.
  await new Promise<void>((resolve) => process.stdin.on("close", resolve));
}
