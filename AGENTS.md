# Project agent memory

Project-intrinsic knowledge for agents working on apple-mail-axi.

## What this is

An agent-first CLI and stdio MCP server for Apple Mail drafts, built on
`axi-sdk-js` (`runAxiCli` in `src/cli.ts`) and `@modelcontextprotocol/sdk`.
Scaffold copied from the sibling [fireflies-axi](https://github.com/simkimsia/fireflies-axi);
conventions from [axi-playbook](https://github.com/simkimsia/axi-playbook).
Scope, interface and safety rules are in [VISION.md](VISION.md): read it
before any change. It never sends mail.

## Architecture

- `src/core/` holds all mail logic. `drafts.ts` has the four operations,
  validation, sender resolution, argv building and read-back verification.
  `operations.ts` is the single registry both ways in are generated from:
  CLI flags, MCP tool names and input schemas all come from it.
- `src/core/runner.ts` is the only module that spawns `osascript`, through
  the injectable `OsaRunner` seam (`CoreDeps.run`). Scripts are fixed files
  in `osa/`, run as `osascript -l <lang> <path> <values...>`. The path comes
  before the values, so a value starting with `-` is never an osascript flag.
  `AXI_DEBUG=1` prints the argv (values capped at 80 chars) on stderr.
- `src/core/errors.ts`: `mapOsascriptError` is ordered, first match wins:
  our `AMA_ERR:<CODE>` markers thrown by the scripts, then Apple Event
  numbers (-1743 Automation, -600 not running, -1712 timeout). The fix texts
  in VISION.md's error table are printed verbatim (`AUTOMATION_FIX`), and
  `test/errors.test.ts` reads VISION.md to enforce it.
- Next steps (`help:`) are written once in the core as `call(op, args)` and
  `param(key)` parts (`src/core/errors.ts`) and rendered per way in by
  `src/core/steps.ts` from the registry: CLI output names
  `apple-mail-axi draft view 9000` and `--flags`, MCP output names
  `` `draft_view` `` with `{id: '9000'}` and argument names. Never write a
  CLI command or flag into a step as plain text.
- `src/invoke.ts` and `src/render.ts` are shared by both ways in, so the same
  input gives the same data, error message, error code and number of steps.
  `src/cli/` only parses argv (plus `--body-file -` for stdin); `src/mcp/server.ts` only maps tool
  arguments. All MCP schema fields are optional on purpose, so required
  checks happen in the core and produce the same `VALIDATION_ERROR`.
- `apple-mail-axi mcp` is intercepted in `main()` before `runAxiCli`,
  because the MCP transport owns stdout.
- `bin/apple-mail-axi.ts` answers `--version` through `axi-sdk-js/fast-path`;
  `src/version.ts` must stay a leaf module.

## Mail.app notes

Split by evidence. CONFIRMED means observed on the user's Mail.app on
2026-10-27, macOS Darwin 24.6.0, iCloud account only (see STATUS.md "Live
run 1" and "Live probes"). Everything else is UNVERIFIED: from Apple's
scripting dictionary, public reports or reasoning. Move a point up only
with a dated observation.

### CONFIRMED (2026-10-27, Darwin 24.6.0, iCloud)

- With Mail closed, the scripts' `AMA_ERR:MAIL_NOT_RUNNING` marker fires and
  the CLI prints `MAIL_NOT_RUNNING` with the VISION fix.
- The Automation prompt appears on the first real call (it was granted, so
  the denial path itself is not confirmed).
- A hidden compose (`visible:false`) plus `save` never reaches any Drafts
  mailbox (unified or per account). The hidden outgoing message then stays
  in `Mail.outgoingMessages()`: `close saving no` does nothing, nor does
  `set visible to true` first. Only quitting Mail clears it. Never compose
  hidden.
- A visible compose works: `make new outgoing message` with `visible:true`,
  set sender (the account's `Full Name <address>`), add a to recipient,
  `tell content to make new attachment with properties {file name:POSIX file
p} at after last paragraph`, `delay 2`, `save`. The draft lands in the
  account's Drafts with the right sender, to and attachment count.
  `osa/create-draft.applescript` follows this path; cc, bcc, several
  attachments and the settle poll before the pause are not yet observed.
- After `save` the visible compose window stays open; `close o saving no`
  closes it and the saved draft survives. A compose window therefore shows
  on screen for a few seconds during every create.
- The draft id stayed the same for about a minute on iCloud IMAP, with the
  attachment still there.
- `osa/delete-draft.js` finds the draft through `draftsMailbox()` and Mail
  moves it to the account's "Deleted Messages".
- `left` is a reserved word in AppleScript (-10003); never use it as a
  variable name. (`ref` is one too by the language guide, not observed.)

### UNVERIFIED

- Exchange, Gmail and other IMAP accounts: id stability after sync, where
  the draft lands, attachment timing. The read-back loop rescans on
  `DRAFT_NOT_FOUND` in case sync replaces the local copy under a new id.
- Whether the attachment settle poll (`count of attachments of content`,
  budget `settleMs` in drafts.ts) is needed on top of the fixed 2 s pause,
  and whether 2 s is enough for large or many files.
- `id` of an outgoing message (`osa/list-outgoing.js`,
  `osa/discard-outgoing.applescript`): read as Mail's dictionary describes,
  not yet observed. If it reads as empty, the core cannot close a leftover
  by id and reports `COMPOSE_LEFT_OPEN`.
- The account a draft reports (`m.mailbox().account().name()` from the
  unified `draftsMailbox()`) matching the account name `--from` resolved
  to. The read-back filter accepts an empty account, so a wrong guess here
  shows up as the sender check in `DRAFT_MISMATCH`, not as a silent pass.
- Create is AppleScript because JXA's attachment support in Mail is widely
  reported broken; read, list and delete are JXA so they return JSON.
- The verbatim osascript stderr for every error. `test/errors.test.ts`
  labels each fixture CONFIRMED_PATH or GUESSED; none is a verbatim capture
  yet. The Automation (-1743), not-running (-600) and timeout (-1712)
  patterns come from Apple's documented numbers.
- Whether the visible compose window steals focus from the user's current
  app, and what happens if the user types into it during the few seconds
  it is open.

## Live smoke procedure

Only with the user's approval. With Mail open:

```sh
APPLE_MAIL_AXI_LIVE=1 pnpm vitest run test/live.smoke.test.ts
```

It sends from the iCloud account by default (`APPLE_MAIL_AXI_LIVE_FROM`
takes another account name or address). It creates one draft named
`apple-mail-axi-smoke <timestamp>` with a small text attachment to
`smoke@example.com`, reads it back, lists it, views it and deletes it, and
then asserts that no outgoing message it opened is still in
`Mail.outgoingMessages()`. A compose window shows briefly during the
create. If it fails midway, delete the leftover draft by hand in Mail, and
close any leftover compose window with Don't Save. Also try each error
path once and record the verbatim stderr with `AXI_DEBUG=1`: Mail closed,
Automation switched off, an unknown `--from`.

## Safety rules enforced by tests

- `test/no-send.test.ts` fails if any file in `osa/` mentions sending
  (except the `sender` property), the outbox, delivery, shell scripts,
  reply, forward or redirect, if `osa/` holds a file the runner does not
  know, or if any script text appears in `src/`.
- `test/parity.test.ts` drives the CLI and the MCP server with the same
  inputs against one fake Mail and requires identical data, error message,
  error code, step count and osascript calls, with CLI wording on one side
  and MCP wording on the other.
- `test/outgoing.test.ts` requires that create leaves no outgoing message of
  its own on success and on every failure path (including osascript being
  killed mid-script), never touches the user's own compose windows, and
  that `osa/create-draft.applescript` composes visibly and closes its
  message on the error path and after save.
- Delete looks a draft up only inside `draftsMailbox()`, so any other id is
  `DRAFT_NOT_FOUND`, and the id must be all digits.

## Conventions

- pnpm, Node >= 20, ES modules, TypeScript Node16 resolution (import
  specifiers end in `.js`), Vitest tests in `test/`.
- Tests are offline: `osascript` is never spawned (the `OsaRunner` is a fake
  in `test/fake-mail.ts`), except the live smoke test behind its env flag.
- Conventional commit messages. Releases are cut by release-please; the first
  npm publish is by hand (see axi-playbook distribution.md).

## Maintaining this file

Keep entries concise and durable; point at the authoritative file rather than
restating what the code shows. Prefer rewriting or pruning over appending.
