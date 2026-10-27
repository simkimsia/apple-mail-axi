import { describe, expect, it } from "vitest";
import { call, param } from "../src/core/errors.js";
import { renderStep } from "../src/core/steps.js";

describe("renderStep", () => {
  it("words an operation as a CLI command or an MCP tool call", () => {
    const step = [call("draft_view", { id: "9000", full: true }), " to look"];
    expect(renderStep(step, "cli")).toBe(
      "Run `apple-mail-axi draft view 9000 --full` to look",
    );
    expect(renderStep(step, "mcp")).toBe(
      "Call the `draft_view` tool with `{id: '9000', full: true}` to look",
    );
  });

  it("repeats list flags on the CLI and keeps the list for MCP", () => {
    const step = [
      call("draft_create", {
        to: ["<address>"],
        subject: "<subject>",
        body: "two words",
      }),
    ];
    expect(renderStep(step, "cli")).toBe(
      'Run `apple-mail-axi draft create --to <address> --subject <subject> --body "two words"`',
    );
    expect(renderStep(step, "mcp")).toBe(
      "Call the `draft_create` tool with `{to: ['<address>'], subject: '<subject>', body: 'two words'}`",
    );
  });

  it("names a parameter by its CLI flag or MCP argument", () => {
    const step = ["Pass ", param("bodyFile")];
    expect(renderStep(step, "cli")).toBe("Pass `--body-file`");
    expect(renderStep(step, "mcp")).toBe("Pass `body_file`");
  });

  it("leaves a plain string step alone", () => {
    expect(renderStep("`open -a Mail`", "mcp")).toBe("`open -a Mail`");
  });

  it("refuses to render a step for an operation or argument that does not exist", () => {
    expect(() => renderStep([call("draft_send")], "cli")).toThrow();
    expect(() =>
      renderStep([call("draft_view", { nope: 1 })], "mcp"),
    ).toThrow();
    expect(() => renderStep([param("nope")], "cli")).toThrow();
  });
});
