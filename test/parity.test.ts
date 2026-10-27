/**
 * VISION.md Interface: every capability is reachable through the CLI and the
 * MCP server with the same arguments, safety rules and errors. This drives
 * both ways in against the same fake Mail and compares what comes out.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { main } from "../src/cli.js";
import { cliFlags } from "../src/cli/parse.js";
import { OPERATIONS } from "../src/core/operations.js";
import { buildMcpServer } from "../src/mcp/server.js";
import { draft, FakeMail, fakeDeps, fakeFs } from "./fake-mail.js";

const FILES = fakeFs(
  { "/work/a.pdf": "file" },
  { "/work/body.txt": "file body" },
);

function deps(mail: FakeMail) {
  return fakeDeps(mail, FILES);
}

async function viaCli(
  mail: FakeMail,
  argv: string[],
): Promise<{ text: string; exitCode: number }> {
  let text = "";
  await main({
    argv,
    stdout: { write: (c: string) => (text += c) },
    deps: deps(mail),
  });
  const exitCode = Number(process.exitCode ?? 0);
  process.exitCode = 0;
  return { text, exitCode };
}

async function mcpClient(mail: FakeMail): Promise<Client> {
  const server = buildMcpServer(deps(mail));
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const client = new Client({ name: "parity-test", version: "0" });
  await client.connect(b);
  return client;
}

async function viaMcp(
  mail: FakeMail,
  tool: string,
  args: Record<string, unknown>,
) {
  const client = await mcpClient(mail);
  const r = (await client.callTool({ name: tool, arguments: args })) as {
    content: { type: string; text: string }[];
    isError?: boolean;
  };
  await client.close();
  return {
    text: r.content.map((c) => c.text).join(""),
    isError: r.isError === true,
  };
}

afterEach(() => {
  process.exitCode = 0;
});

describe("surface parity", () => {
  it("MCP lists exactly one tool per core operation, with the spec's argument names", async () => {
    const client = await mcpClient(new FakeMail());
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      OPERATIONS.map((o) => o.name).sort(),
    );
    for (const op of OPERATIONS) {
      const tool = tools.find((t) => t.name === op.name)!;
      expect(Object.keys(tool.inputSchema.properties ?? {}).sort()).toEqual(
        op.params.map((p) => p.mcp).sort(),
      );
      expect(tool.annotations?.readOnlyHint).toBe(!op.write);
    }
    await client.close();
  });

  it("every operation's CLI flags come from the same spec", () => {
    for (const op of OPERATIONS) {
      expect(cliFlags(op)).toEqual(
        op.params.filter((p) => !p.positional).map((p) => p.cli),
      );
    }
  });

  it("no tool or command can send: nothing in the spec is named for it", () => {
    for (const op of OPERATIONS) {
      expect(`${op.name} ${op.cli.join(" ")} ${op.summary}`).not.toMatch(
        /\bsend(?!s mail)\b/i,
      );
    }
  });
});

type Scenario = {
  name: string;
  cli: string[];
  tool: string;
  args: Record<string, unknown>;
  mail?: () => FakeMail;
  /** Text the output must contain, so parity is never two identical failures. */
  expect: string;
};

const SCENARIOS: Scenario[] = [
  {
    name: "create with every field",
    expect: "created:",
    cli: [
      "draft",
      "create",
      "--to",
      "ana@example.com",
      "--to",
      "bo@example.com",
      "--cc",
      "cy@example.com",
      "--bcc",
      "di@example.com",
      "--subject",
      "Q3",
      "--body-file",
      "body.txt",
      "--attach",
      "a.pdf",
      "--from",
      "Work",
    ],
    tool: "draft_create",
    args: {
      to: ["ana@example.com", "bo@example.com"],
      cc: ["cy@example.com"],
      bcc: ["di@example.com"],
      subject: "Q3",
      body_file: "body.txt",
      attach: ["a.pdf"],
      from: "Work",
    },
  },
  {
    name: "create without subject",
    expect: "code: VALIDATION_ERROR",
    cli: ["draft", "create", "--to", "ana@example.com"],
    tool: "draft_create",
    args: { to: ["ana@example.com"] },
  },
  {
    name: "create with missing attachment",
    expect: "code: ATTACHMENT_NOT_FOUND",
    cli: ["draft", "create", "--subject", "s", "--attach", "/nope"],
    tool: "draft_create",
    args: { subject: "s", attach: ["/nope"] },
  },
  {
    name: "create with unknown sender",
    expect: "code: UNKNOWN_SENDER",
    cli: ["draft", "create", "--subject", "s", "--from", "x@y.example"],
    tool: "draft_create",
    args: { subject: "s", from: "x@y.example" },
  },
  {
    name: "create where Mail drops an attachment",
    expect: "code: DRAFT_MISMATCH",
    cli: ["draft", "create", "--subject", "s", "--attach", "a.pdf"],
    tool: "draft_create",
    args: { subject: "s", attach: ["a.pdf"] },
    mail: () => new FakeMail({ dropAttachments: 1 }),
  },
  {
    name: "list",
    expect: "count: 2 of 3 total",
    cli: ["draft", "list", "--limit", "2"],
    tool: "draft_list",
    args: { limit: 2 },
    mail: () => new FakeMail({ drafts: [draft("1"), draft("2"), draft("3")] }),
  },
  {
    name: "list empty",
    expect: "drafts: 0 drafts",
    cli: ["draft", "list"],
    tool: "draft_list",
    args: {},
  },
  {
    name: "view",
    expect: "draft:",
    cli: ["draft", "view", "2", "--full"],
    tool: "draft_view",
    args: { id: "2", full: true },
    mail: () => new FakeMail({ drafts: [draft("2")] }),
  },
  {
    name: "view unknown id",
    expect: "code: DRAFT_NOT_FOUND",
    cli: ["draft", "view", "77"],
    tool: "draft_view",
    args: { id: "77" },
  },
  {
    name: "delete",
    expect: "deleted:",
    cli: ["draft", "delete", "2"],
    tool: "draft_delete",
    args: { id: "2" },
    mail: () => new FakeMail({ drafts: [draft("2")] }),
  },
  {
    name: "delete partial id",
    expect: "code: VALIDATION_ERROR",
    cli: ["draft", "delete", "2*"],
    tool: "draft_delete",
    args: { id: "2*" },
  },
  {
    name: "permission denied",
    expect: "code: AUTOMATION_DENIED",
    cli: ["draft", "list"],
    tool: "draft_list",
    args: {},
    mail: () =>
      new FakeMail({
        fail: {
          kind: "exit",
          exitCode: 1,
          stderr:
            "x: execution error: Not authorized to send Apple events to Mail. (-1743)",
        },
      }),
  },
  {
    name: "Mail not running",
    expect: "code: MAIL_NOT_RUNNING",
    cli: ["draft", "view", "2"],
    tool: "draft_view",
    args: { id: "2" },
    mail: () =>
      new FakeMail({
        fail: {
          kind: "exit",
          exitCode: 1,
          stderr: "x: execution error: Error: AMA_ERR:MAIL_NOT_RUNNING (-2700)",
        },
      }),
  },
];

describe("CLI and MCP give the same result for the same input", () => {
  for (const s of SCENARIOS) {
    it(s.name, async () => {
      const cliMail = s.mail?.() ?? new FakeMail();
      const mcpMail = s.mail?.() ?? new FakeMail();
      const cli = await viaCli(cliMail, s.cli);
      const mcp = await viaMcp(mcpMail, s.tool, s.args);
      expect(cli.text).toContain(s.expect);
      expect(mcp.text.trimEnd()).toBe(cli.text.trimEnd());
      expect(mcp.isError).toBe(cli.exitCode !== 0);
      // The same core calls reached Mail, with the same argv.
      expect(mcpMail.requests).toEqual(cliMail.requests);
    });
  }

  it("CLI-only stdin body reaches the core as a body", async () => {
    const mail = new FakeMail();
    let text = "";
    await main({
      argv: ["draft", "create", "--subject", "s", "--body-file", "-"],
      stdout: { write: (c: string) => (text += c) },
      deps: deps(mail),
      readStdin: async () => "piped body",
    });
    expect(text).toContain("created:");
    expect(mail.calls("create-draft")[0].argv[1]).toBe("piped body");
  });

  it("CLI rejects unknown flags by name before Mail is called", async () => {
    const mail = new FakeMail();
    const r = await viaCli(mail, [
      "draft",
      "create",
      "--subject",
      "s",
      "--sned",
    ]);
    expect(r.exitCode).toBe(2);
    expect(r.text).toContain("unknown flag --sned");
    expect(mail.requests).toEqual([]);
  });
});
