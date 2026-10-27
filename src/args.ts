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

/**
 * Take an integer flag, defaulting when absent and clamping to [1, max].
 * Non-integers are a VALIDATION_ERROR; values above max are clamped rather
 * than rejected so an agent asking for "everything" still gets a bounded page.
 */
export function takeIntFlag(
  args: string[],
  flag: string,
  fallback: number,
  max: number,
): number {
  const raw = takeFlag(args, flag);
  if (raw === undefined) return fallback;
  if (!/^\d+$/.test(raw)) {
    throw new AxiError(
      `${flag} must be a positive integer, got ${raw}`,
      "VALIDATION_ERROR",
      [`Pass a whole number of at least 1, e.g. \`${flag} ${fallback}\``],
    );
  }
  const n = Number(raw);
  if (n < 1) {
    throw new AxiError(`${flag} must be at least 1`, "VALIDATION_ERROR", [
      `Pass a whole number of at least 1, e.g. \`${flag} ${fallback}\``,
    ]);
  }
  return Math.min(n, max);
}

/**
 * Take an integer flag that may be zero (an offset), defaulting when absent.
 * Negative numbers and non-integers are a VALIDATION_ERROR.
 */
export function takeNonNegativeIntFlag(
  args: string[],
  flag: string,
  fallback: number,
): number {
  const raw = takeFlag(args, flag);
  if (raw === undefined) return fallback;
  if (!/^\d+$/.test(raw)) {
    throw new AxiError(
      `${flag} must be a whole number of 0 or more, got ${raw}`,
      "VALIDATION_ERROR",
      [`Pass a whole number of at least 0, e.g. \`${flag} ${fallback}\``],
    );
  }
  return Number(raw);
}

/** Take the first positional (non-option) token out of args, if any. */
export function takePositional(args: string[]): string | undefined {
  const idx = args.findIndex((a) => !isOptionToken(a));
  if (idx === -1) return undefined;
  return args.splice(idx, 1)[0];
}
