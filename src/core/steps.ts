/**
 * Render next steps per way in. A step is written once in the core (see
 * `call` and `param` in errors.ts) and turned into a CLI command or an MCP
 * tool call here, from the same registry both ways in are generated from.
 * The error code and the number and order of steps never depend on the way
 * in; only the wording of commands and argument names does.
 */
import type { Step, StepPart, StepValue } from "./errors.js";
import {
  OPERATIONS,
  type OperationSpec,
  type ParamSpec,
} from "./operations.js";

export type Transport = "cli" | "mcp";

function spec(name: string): OperationSpec {
  const op = OPERATIONS.find((o) => o.name === name);
  if (!op) throw new Error(`step names unknown operation ${name}`);
  return op;
}

function paramSpec(key: string): ParamSpec {
  for (const op of OPERATIONS) {
    const p = op.params.find((x) => x.key === key);
    if (p) return p;
  }
  throw new Error(`step names unknown parameter ${key}`);
}

/** A CLI value: bare when safe or a `<placeholder>`, double-quoted otherwise. */
function cliValue(value: string): string {
  return /^[\w@%+=:,./<>-]+$/.test(value) ? value : JSON.stringify(value);
}

function cliCommand(
  op: OperationSpec,
  args: Record<string, StepValue>,
): string {
  const words = ["apple-mail-axi", ...op.cli];
  for (const p of op.params) {
    if (p.positional && args[p.key] !== undefined) {
      words.push(cliValue(String(args[p.key])));
    }
  }
  for (const [key, value] of Object.entries(args)) {
    const p = op.params.find((x) => x.key === key);
    if (!p)
      throw new Error(`step passes unknown argument ${key} to ${op.name}`);
    if (p.positional) continue;
    if (p.kind === "boolean") {
      if (value === true) words.push(p.cli);
    } else if (Array.isArray(value)) {
      for (const v of value) words.push(p.cli, cliValue(v));
    } else {
      words.push(p.cli, cliValue(String(value)));
    }
  }
  return `Run \`${words.join(" ")}\``;
}

/**
 * An MCP argument value. Strings are single-quoted so the step survives TOON
 * output without escaped double quotes; numbers and booleans stay bare.
 */
function mcpValue(value: StepValue): string {
  if (Array.isArray(value)) return `[${value.map(mcpValue).join(", ")}]`;
  if (typeof value === "string") return `'${value.replace(/'/g, "\\'")}'`;
  return String(value);
}

function mcpCall(op: OperationSpec, args: Record<string, StepValue>): string {
  const shown: string[] = [];
  for (const [key, value] of Object.entries(args)) {
    const p = op.params.find((x) => x.key === key);
    if (!p)
      throw new Error(`step passes unknown argument ${key} to ${op.name}`);
    shown.push(`${p.mcp}: ${mcpValue(value)}`);
  }
  const withArgs = shown.length > 0 ? ` with \`{${shown.join(", ")}}\`` : "";
  return `Call the \`${op.name}\` tool${withArgs}`;
}

function part(p: StepPart, t: Transport): string {
  if (typeof p === "string") return p;
  if ("call" in p) {
    const op = spec(p.call);
    return t === "cli"
      ? cliCommand(op, p.args ?? {})
      : mcpCall(op, p.args ?? {});
  }
  const ps = paramSpec(p.param);
  return `\`${t === "cli" ? ps.cli : ps.mcp}\``;
}

export function renderStep(step: Step, t: Transport): string {
  return typeof step === "string" ? step : step.map((p) => part(p, t)).join("");
}

export function renderSteps(steps: Step[], t: Transport): string[] {
  return steps.map((s) => renderStep(s, t));
}
