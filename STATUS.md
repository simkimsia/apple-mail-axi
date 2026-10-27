# Status

As of 2026-10-27, on branch `v1-take1` (not pushed).

## Where it stands

v1 take 1 of a 3-take budget is built and tested offline.
`draft create`, `draft list`, `draft view` and `draft delete` work through the CLI and through `apple-mail-axi mcp`, over one core (`src/core/`).
`pnpm test`, `pnpm run build` and `pnpm run format:check` pass.
Nothing has run against a real Mail.app yet.

## Not done on purpose

- No live run. The user approves the first one (`APPLE_MAIL_AXI_LIVE=1`, see AGENTS.md "Live smoke procedure").
- Not pushed, no PR, not published to npm.
- `bench/` is laid out from the axi-bench template, but Mail needs a macOS host runner, and the fixture scripts are not written.
- No reading or search (v2), no reply or forward drafts.

## Open questions for the live run

Listed in AGENTS.md "Mail.app notes": draft id stability on IMAP sync, attachment timing and `visible:false`, the unified Drafts mailbox, `set sender` matching, what delete does, whether the compose object must be closed, and the real osascript stderr for each error.

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
