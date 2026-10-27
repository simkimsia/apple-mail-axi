import { AxiError } from "./core/errors.js";

/**
 * AXI §6: fail loud on unrecognized input. Commands parse the flags they know
 * with the take* helpers below, then hand whatever is left to this so a typo
 * is rejected by name before any Mail call.
 */
export function assertNoArgs(
  command: string,
  args: string[],
  validFlags: string[] = [],
): void {
  if (args.length === 0) return;
  const kind = args[0].startsWith("-") ? "flag" : "argument";
  // Inline the accepted flags so the agent can self-correct in one turn.
  const valid =
    validFlags.length > 0
      ? `valid flags for \`${command}\`: ${validFlags.join(", ")} (--help always allowed)`
      : `\`${command}\` takes no flags (--help always allowed)`;
  throw new AxiError(
    `unknown ${kind} ${args[0]} for \`${command}\``,
    "VALIDATION_ERROR",
    [valid],
  );
}

export function isOptionToken(token: string | undefined): boolean {
  return token !== undefined && token.startsWith("-") && token !== "-";
}

/**
 * Take `--flag value` or `--flag=value` out of args and return the value.
 * Throws VALIDATION_ERROR (args untouched) when the space form is followed by
 * another option token or nothing, so `--service --limit 5` cannot silently
 * consume `--limit` as the service name. `--flag=-dashy` remains the escape
 * hatch for values that start with a dash.
 */
export function takeFlag(args: string[], flag: string): string | undefined {
  const equalsPrefix = `${flag}=`;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === flag) {
      const value = args[i + 1];
      if (isOptionToken(value)) {
        throw new AxiError(
          `${flag} requires a value, but ${value} looks like an option`,
          "VALIDATION_ERROR",
          [
            `Use \`${flag}=${JSON.stringify(value)}\` for a value that starts with a dash`,
          ],
        );
      }
      if (value === undefined || value.trim() === "") {
        throw new AxiError(`${flag} requires a value`, "VALIDATION_ERROR", [
          `Use \`${flag} <value>\` or \`${flag}=<value>\``,
        ]);
      }
      args.splice(i, 2);
      return value;
    }
    if (arg.startsWith(equalsPrefix)) {
      const value = arg.slice(equalsPrefix.length);
      if (value.trim() === "") {
        throw new AxiError(`${flag} requires a value`, "VALIDATION_ERROR", [
          `Use \`${flag} <value>\` or \`${flag}=<value>\``,
        ]);
      }
      args.splice(i, 1);
      return value;
    }
  }
  return undefined;
}

/** Take a boolean flag out of args; true if it was present. */
export function takeBoolFlag(args: string[], flag: string): boolean {
  const idx = args.indexOf(flag);
  if (idx === -1) return false;
  args.splice(idx, 1);
  return true;
}

/** Take the first positional (non-option) token out of args, if any. */
export function takePositional(args: string[]): string | undefined {
  const idx = args.findIndex((a) => !isOptionToken(a));
  if (idx === -1) return undefined;
  return args.splice(idx, 1)[0];
}
