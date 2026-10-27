/**
 * The single list of mail capabilities. The CLI parser and the MCP tool
 * schemas are both generated from it, so the two ways in cannot drift apart
 * on names, arguments or errors (VISION.md Interface). test/parity.test.ts
 * checks this.
 */
import {
  createDraft,
  deleteDraft,
  listDrafts,
  viewDraft,
  DEFAULT_LIST_LIMIT,
  MAX_LIST_LIMIT,
  type CoreDeps,
} from "./drafts.js";

export type ParamKind = "string" | "string[]" | "boolean" | "integer";

export interface ParamSpec {
  /** Key in the core input object. */
  key: string;
  /** CLI flag (`--to`), or `<id>` style name for a positional. */
  cli: string;
  /** MCP tool argument name. */
  mcp: string;
  kind: ParamKind;
  positional?: boolean;
  required?: boolean;
  description: string;
}

export interface OperationSpec {
  /** MCP tool name. */
  name: string;
  /** CLI words after `apple-mail-axi`. */
  cli: [string, string];
  /** Does this operation change Mail state? */
  write: boolean;
  summary: string;
  params: ParamSpec[];
  run: (input: Record<string, unknown>, deps?: CoreDeps) => Promise<unknown>;
}

export const OPERATIONS: OperationSpec[] = [
  {
    name: "draft_create",
    cli: ["draft", "create"],
    write: true,
    summary:
      "Save a new plain-text draft in Mail's Drafts (never sends). Succeeds only after the saved draft is read back and its recipients, subject and attachment count match. A Mail compose window shows on screen until then and is closed without sending.",
    params: [
      {
        key: "to",
        cli: "--to",
        mcp: "to",
        kind: "string[]",
        description: "To address; repeat for more",
      },
      {
        key: "cc",
        cli: "--cc",
        mcp: "cc",
        kind: "string[]",
        description: "Cc address; repeat for more",
      },
      {
        key: "bcc",
        cli: "--bcc",
        mcp: "bcc",
        kind: "string[]",
        description: "Bcc address; repeat for more",
      },
      {
        key: "subject",
        cli: "--subject",
        mcp: "subject",
        kind: "string",
        required: true,
        description: "Subject line (required, one line)",
      },
      {
        key: "body",
        cli: "--body",
        mcp: "body",
        kind: "string",
        description: "Plain-text body",
      },
      {
        key: "bodyFile",
        cli: "--body-file",
        mcp: "body_file",
        kind: "string",
        description:
          "Read the plain-text body from this file (CLI: `-` reads stdin)",
      },
      {
        key: "attach",
        cli: "--attach",
        mcp: "attach",
        kind: "string[]",
        description: "File path to attach; repeat for more",
      },
      {
        key: "from",
        cli: "--from",
        mcp: "from",
        kind: "string",
        description:
          "Sender: a Mail account name or one of its addresses (default: Mail's default account)",
      },
    ],
    run: (input, deps) => createDraft(input, deps),
  },
  {
    name: "draft_list",
    cli: ["draft", "list"],
    write: false,
    summary:
      "List drafts in Mail's Drafts mailbox, newest first, with the total count.",
    params: [
      {
        key: "limit",
        cli: "--limit",
        mcp: "limit",
        kind: "integer",
        description: `Rows to show (default ${DEFAULT_LIST_LIMIT}, max ${MAX_LIST_LIMIT})`,
      },
    ],
    run: (input, deps) => listDrafts(input, deps),
  },
  {
    name: "draft_view",
    cli: ["draft", "view"],
    write: false,
    summary: "Show one draft: recipients, sender, attachments and the body.",
    params: [
      {
        key: "id",
        cli: "<id>",
        mcp: "id",
        kind: "string",
        positional: true,
        required: true,
        description: "Full draft id from draft list",
      },
      {
        key: "full",
        cli: "--full",
        mcp: "full",
        kind: "boolean",
        description: "Show the whole body (default: first 1500 chars)",
      },
    ],
    run: (input, deps) => viewDraft(input, deps),
  },
  {
    name: "draft_delete",
    cli: ["draft", "delete"],
    write: true,
    summary:
      "Delete one draft by its full id. Refuses any id that is not in Mail's Drafts mailbox.",
    params: [
      {
        key: "id",
        cli: "<id>",
        mcp: "id",
        kind: "string",
        positional: true,
        required: true,
        description: "Full draft id from draft list",
      },
    ],
    run: (input, deps) => deleteDraft(input, deps),
  },
];

export function operation(name: string): OperationSpec {
  const op = OPERATIONS.find((o) => o.name === name);
  if (!op) throw new Error(`unknown operation ${name}`);
  return op;
}
