/**
 * Run one operation and render its result or error. Both the CLI and the MCP
 * server call this, so a given input yields the same text and error code
 * through either way in.
 */
import {
  AxiError,
  exitCodeForError,
  UNKNOWN_SUGGESTION,
} from "./core/errors.js";
import type { CoreDeps } from "./core/drafts.js";
import { operation } from "./core/operations.js";
import type { Transport } from "./core/steps.js";
import { RENDERERS, renderError } from "./render.js";

export interface InvokeResult {
  text: string;
  isError: boolean;
  code?: string;
  exitCode: number;
}

export function toAxiError(error: unknown): AxiError {
  return error instanceof AxiError
    ? error
    : new AxiError(
        error instanceof Error ? error.message : String(error),
        "UNKNOWN",
        [UNKNOWN_SUGGESTION],
      );
}

export async function invoke(
  name: string,
  input: Record<string, unknown>,
  transport: Transport,
  deps?: CoreDeps,
): Promise<InvokeResult> {
  const op = operation(name);
  try {
    const result = await op.run(input, deps);
    return {
      text: RENDERERS[name](result as never, transport),
      isError: false,
      exitCode: 0,
    };
  } catch (error) {
    const axi = toAxiError(error);
    return {
      text: renderError(axi, transport),
      isError: true,
      code: axi.code,
      exitCode: exitCodeForError(axi),
    };
  }
}
