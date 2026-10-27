# Status

As of 2026-10-27, on branch `v1-take2` (from `v1-take1`, not pushed).

## Where it stands

v1 take 2 of a 3-take budget is built and tested offline.
Create now follows the path the live probes confirmed (visible compose, save, close saving no) and checks that no compose window of its own is left, on success and failure.
Next steps are worded per way in (CLI commands vs MCP tool names) from one core step list.
`pnpm test`, `pnpm run build` and `pnpm run format:check` pass.
The take-2 create script has not run against a real Mail.app yet.

## Not done on purpose

- No live run of take 2. The main session runs the smoke test with the user (`APPLE_MAIL_AXI_LIVE=1`, iCloud by default, see AGENTS.md "Live smoke procedure").
- Not pushed, no PR, not published to npm.
- `bench/` is laid out from the axi-bench template, but Mail needs a macOS host runner, and the fixture scripts are not written.
- No reading or search (v2), no reply or forward drafts.

## Open questions for the take-2 live run

Listed under "UNVERIFIED" in AGENTS.md "Mail.app notes": outgoing message `id` (the leftover check depends on it), the account name a draft reports, cc/bcc and several attachments on the visible path, the settle timings, focus stealing, other account types, and the verbatim stderr for each error.

## Take note (take 1 → take 2)

- Learned: Generating both ways in from one operation registry made CLI/MCP parity structural and cheap to test, so the interface layer is not where the risk is. The risk is all Mail.app behaviour this take could only assume: how a saved draft is found again (id diff plus exact subject), whether ids survive server sync, attachment timing with an invisible compose window, and the real stderr behind each error code. Error help also names CLI commands even when it is returned over MCP.
- Change: Make take 2 evidence-first. Start with the approved live run and capture real osascript output and stderr as fixtures, then rebuild draft identity and read-back around what Mail actually does (a stable key if ids change on sync, `visible` chosen by evidence, settle and poll timings from measurements). Generate error next steps per transport from the registry (CLI command or MCP tool name).
- Keep: `src/core/operations.ts` as the single registry, the `OsaRunner` seam and `test/fake-mail.ts`, fixed scripts in `osa/` that take values only through argv, the no-send guard and its self-test, the VISION error-table test, and the parity scenarios.

## Live run 1 (2026-10-27, user-approved, macOS Darwin 24.6.0)

- Mail closed: `MAIL_NOT_RUNNING` fired and printed the VISION fix. Confirmed.
- Automation prompt appeared on first real call and was granted. Confirmed.
- `make new outgoing message` with `visible:false` + `save`: the draft never reached any Drafts mailbox (unified or per account: iCloud, SMU, IMC). Read-back correctly failed with `DRAFT_NOT_SAVED` after 30s.
- The hidden outgoing message stays in `Mail.outgoingMessages()`. `close o saving no` does nothing, and neither does `set visible to true` followed by `close saving no`. Only quitting Mail clears it.
- Take 2 must: create drafts by a route that actually lands in Drafts (to be probed live), and clean up its own outgoing message on every failure path.

## Live probes (2026-10-27, user-approved, iCloud account only)

- `make new outgoing message` with `visible:true`, sender `Kim Sia <kimsia.sim@icloud.com>`, one to recipient, one attachment added `at after last paragraph`, `delay 2`, `save`: the draft landed in iCloud Drafts with attachments=1, the right sender and the right to. Confirmed.
- After `save`, the visible outgoing message stays open. `close o saving no` on a visible one closes it and the saved draft survives. Confirmed.
- The draft id (283100) was unchanged about a minute later (iCloud IMAP), and attachments still 1. Not yet tested on Exchange or other IMAP.
- `osa/delete-draft.js <id>` worked unchanged: it found the draft through `draftsMailbox()` and moved it to iCloud "Deleted Messages". Confirmed.
- `left` is a reserved word in AppleScript (-10003); avoid it as a variable name.
- Probes B (`close saving yes`) and C (.eml handoff) were skipped because A covers the path.

## Take note (take 2 → take 3)

- Learned: The evidence moved the risk from "how do we find the draft" to "what do we leave behind in Mail": a hidden compose cannot be saved or closed, so the one safe path is visible, save, close saving no, and the cleanup has to live in two places (the script's own error handler, and a core check by outgoing id for paths the script never reaches, like osascript being killed). Writing next steps as `call()`/`param()` parts made per-way-in wording cheap and kept codes and step counts identical. What stays assumed is everything the probes did not touch: outgoing message `id`, the account name on a unified-Drafts message, cc/bcc and several attachments on the visible path, and every verbatim stderr.
- Change: Make take 3 the convergence take, driven by the take-2 live smoke run. Capture verbatim stderr (Mail closed, Automation off, unknown sender) and the real `list-outgoing` output into fixtures; if outgoing ids read empty, switch the leftover check to a key Mail does give (subject plus count, or the window); tune `settleMs`/`SAVE_PAUSE_MS` from measured create times; if `account` reads empty on drafts, scope the read-back with a per-account Drafts lookup in the script instead of filtering in the core. Then ship.
- Keep: `src/core/operations.ts` as the single registry, `src/core/steps.ts` per-way-in rendering, the `OsaRunner` seam and `test/fake-mail.ts` with its outgoing model, fixed scripts in `osa/` that take values only through argv, the visible-compose create script with its close on every path, the core outgoing check that never touches the user's own windows, the no-send guard, the VISION error-table test, the parity scenarios, and the iCloud-default live smoke test with its no-leftover assertion.

## Live run 2 + probes D-H (2026-10-27, user-approved, iCloud only)

- Smoke on take 2 (88f52a3): the draft saved (id 285500), but read-back failed with `DRAFT_MISMATCH attachments 0 of 1`. Plain AppleScript `count of mail attachments` also gave 0, so the attachment really was dropped; it was not a JXA miscount.
- Leftover check: `outgoing=0` after the run, so `list-outgoing.js` / `discard-outgoing.applescript` work and outgoing message ids are readable. Confirmed.
- Sender `Kim Sia Sim <kimsia.sim@icloud.com>` was accepted and read back. Confirmed.
- Ruled out: attachment file in `/var/folders/.../T` vs `/private/tmp` (D: still 0), body without a trailing newline (E: still 0), `tell content of draftMessage` vs `tell draftMessage / tell content` (G: still 0).
- Cause: the compose window is closed right after `save`. Adding `delay 3` between `save` and `close saving no` (H) gave attachments=1. `save` returns before Mail has written the attachment into the saved draft, and closing the window first discards it.
- Take 3 fix: after `save`, poll the saved draft in Drafts (new id, exact subject) until its attachment count matches, with a budget, and only then close the compose window. Avoid a fixed delay. If the budget runs out, close and raise `DRAFT_MISMATCH` as now.
- zsh note for manual probes: unquoted `$VAR` does not word-split; use `${=VAR}`.
