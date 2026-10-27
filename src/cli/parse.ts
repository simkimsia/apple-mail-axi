import {
  assertNoArgs,
  takeBoolFlag,
  takeFlag,
  takePositional,
} from "../args.js";
import { validationError } from "../core/errors.js";
import type { OperationSpec } from "../core/operations.js";

/** Take every occurrence of a repeatable `--flag value`. */
export function takeRepeatable(args: string[], flag: string): string[] {
  const values: string[] = [];
  for (;;) {
    const value = takeFlag(args, flag);
    if (value === undefined) return values;
    values.push(value);
  }
}

/** The flags (not positionals) an operation accepts on the CLI. */
export function cliFlags(op: OperationSpec): string[] {
  return op.params.filter((p) => !p.positional).map((p) => p.cli);
}

/**
 * Turn CLI args into the core input object for `op`. Value flags are taken
 * before positionals so a flag's value is never read as the id. Leftovers are
 * rejected by name (AXI §6). Semantic checks stay in the core.
 */
export function parseCli(
  op: OperationSpec,
  args: string[],
): Record<string, unknown> {
  const rest = [...args];
  const input: Record<string, unknown> = {};
  for (const p of op.params) {
    if (p.positional) continue;
    if (p.kind === "string[]") {
      const values = takeRepeatable(rest, p.cli);
      if (values.length > 0) input[p.key] = values;
    } else if (p.kind === "boolean") {
      if (takeBoolFlag(rest, p.cli)) input[p.key] = true;
    } else {
      const value = takeFlag(rest, p.cli);
      if (value !== undefined) input[p.key] = value;
    }
  }
  for (const p of op.params) {
    if (!p.positional) continue;
    const value = takePositional(rest);
    if (value !== undefined) input[p.key] = value;
  }
  const command = op.cli.join(" ");
  if (rest.length > 0 && !rest[0].startsWith("-")) {
    throw validationError(`unexpected argument ${rest[0]} for \`${command}\``, [
      `Run \`apple-mail-axi ${command} --help\` for usage`,
    ]);
  }
  assertNoArgs(command, rest, cliFlags(op));
  return input;
}
