/**
 * Errors shared by the CLI and the MCP server. Every failure carries a stable
 * `code` and at least one next step in `suggestions` (VISION.md Interface).
 * Only VALIDATION_ERROR exits 2; everything else exits 1.
 */
export type ErrorCode =
  | "VALIDATION_ERROR"
  | "AUTOMATION_DENIED"
  | "MAIL_NOT_RUNNING"
  | "MAIL_NOT_SET_UP"
  | "MAIL_TIMEOUT"
  | "ATTACHMENT_NOT_FOUND"
  | "ATTACHMENT_UNREADABLE"
  | "UNKNOWN_SENDER"
  | "DRAFT_NOT_FOUND"
  | "DRAFT_NOT_SAVED"
  | "DRAFT_MISMATCH"
  | "DELETE_NOT_CONFIRMED"
  | "UNSUPPORTED_PLATFORM"
  | "UNKNOWN";

export class AxiError extends Error {
  readonly code: ErrorCode;
  readonly suggestions: string[];

  constructor(message: string, code: ErrorCode, suggestions: string[] = []) {
    super(message);
    this.name = "AxiError";
    this.code = code;
    this.suggestions = suggestions;
  }
}

export function exitCodeForError(error: { code: string }): number {
  return error.code === "VALIDATION_ERROR" ? 2 : 1;
}

export const ISSUES_URL = "https://github.com/simkimsia/apple-mail-axi/issues";
export const UNKNOWN_SUGGESTION = `Rerun with \`AXI_DEBUG=1\` to see the script and argv, then report the gap at ${ISSUES_URL}`;

/** Longest stretch of osascript stderr ever relayed in a message. */
const RELAY_MAX = 200;

export function validationError(message: string, help: string[]): AxiError {
  return new AxiError(message, "VALIDATION_ERROR", help);
}

/** Fix texts VISION.md (Interface, error table) requires verbatim. */
export const AUTOMATION_FIX =
  "System Settings → Privacy & Security → Automation, then allow the terminal to control Mail.";
export const MAIL_NOT_RUNNING_FIX = "`open -a Mail`";

export function automationDeniedError(): AxiError {
  return new AxiError(
    "macOS blocked Automation access to Mail (osascript error -1743)",
    "AUTOMATION_DENIED",
    [
      AUTOMATION_FIX,
      'Under MCP, "the terminal" is the MCP client app (for example Claude); if no switch is listed, `tccutil reset AppleEvents` makes macOS ask again on the next run',
      "Then rerun the same command",
    ],
  );
}

export function mailNotRunningError(): AxiError {
  return new AxiError("Mail.app is not running", "MAIL_NOT_RUNNING", [
    `Run ${MAIL_NOT_RUNNING_FIX}, wait until Mail has loaded, then rerun the same command`,
  ]);
}

export function mailNotSetUpError(): AxiError {
  return new AxiError("Mail.app has no accounts set up", "MAIL_NOT_SET_UP", [
    "Ask the user to add an account in Mail > Settings > Accounts, then rerun the same command",
  ]);
}

export function mailTimeoutError(): AxiError {
  return new AxiError("Mail.app did not answer in time", "MAIL_TIMEOUT", [
    "Mail may be busy syncing; wait a minute and rerun the same command",
    "Run `apple-mail-axi draft list` before rerunning a create, so a late draft is not duplicated",
  ]);
}

export function unsupportedPlatformError(): AxiError {
  return new AxiError(
    "osascript was not found; apple-mail-axi only runs on macOS",
    "UNSUPPORTED_PLATFORM",
    ["Run apple-mail-axi on the Mac that has Mail.app set up"],
  );
}

export function draftNotFoundError(id: string): AxiError {
  return new AxiError(
    `No draft with id ${id} in Mail's Drafts (only drafts are visible to apple-mail-axi)`,
    "DRAFT_NOT_FOUND",
    ["Run `apple-mail-axi draft list` to see draft ids"],
  );
}

/** First non-empty stderr line, osascript's path prefix stripped, capped. */
export function relayLine(stderr: string): string {
  const first =
    stderr
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l !== "") ?? "";
  return first
    .replace(/^.*?execution error:\s*/, "")
    .replace(/^Error:\s*/, "")
    .slice(0, RELAY_MAX);
}

/**
 * Translate a failed osascript run into an AxiError. Ordered, first match
 * wins: our own `AMA_ERR:<CODE>` markers (thrown by the bundled scripts) come
 * first, then Apple Event error numbers.
 *
 * NOTE: the stderr shapes below are written from Apple's documented error
 * numbers, not yet captured verbatim from a live run. Replace the fixtures in
 * test/errors.test.ts with real captures during the first live run.
 */
export function mapOsascriptError(
  stderr: string,
  ctx: { id?: string } = {},
): AxiError {
  const marker = /AMA_ERR:([A-Z_]+)(?::([^()\n]*))?/.exec(stderr);
  if (marker) {
    switch (marker[1]) {
      case "MAIL_NOT_RUNNING":
        return mailNotRunningError();
      case "MAIL_NOT_SET_UP":
        return mailNotSetUpError();
      case "DRAFT_NOT_FOUND":
        return draftNotFoundError(ctx.id ?? marker[2]?.trim() ?? "?");
      case "ATTACHMENT_REJECTED":
        return new AxiError(
          `Mail refused an attachment${marker[2] ? `: ${marker[2].trim()}` : ""}`,
          "ATTACHMENT_UNREADABLE",
          [
            "Check that Mail can read the file (files inside other apps' containers or on unmounted volumes fail); copy it to ~/Downloads and attach that copy",
          ],
        );
    }
  }
  // errAEEventNotPermitted: Automation (TCC) permission for Mail is missing.
  if (
    /\(-1743\)/.test(stderr) ||
    /Not authori[sz]ed to send Apple events/i.test(stderr)
  ) {
    return automationDeniedError();
  }
  // procNotFound: Mail quit between our running check and the call.
  if (/\(-600\)/.test(stderr)) {
    return mailNotRunningError();
  }
  // errAETimeout.
  if (/\(-1712\)/.test(stderr)) {
    return mailTimeoutError();
  }
  const line = relayLine(stderr);
  return new AxiError(
    `Mail script failed${line ? `: ${line}` : ""}`,
    "UNKNOWN",
    [UNKNOWN_SUGGESTION],
  );
}
