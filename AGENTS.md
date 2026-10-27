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
- `src/invoke.ts` and `src/render.ts` are shared by both ways in, so the same
  input gives the same text and error code. `src/cli/` only parses argv
  (plus `--body-file -` for stdin); `src/mcp/server.ts` only maps tool
  arguments. All MCP schema fields are optional on purpose, so required
  checks happen in the core and produce the same `VALIDATION_ERROR`.
- `apple-mail-axi mcp` is intercepted in `main()` before `runAxiCli`,
  because the MCP transport owns stdout.
- `bin/apple-mail-axi.ts` answers `--version` through `axi-sdk-js/fast-path`;
  `src/version.ts` must stay a leaf module.

## Mail.app notes (UNVERIFIED until the first live run)

Everything below is from Apple's scripting dictionary and public reports,
not yet observed by this repo. Confirm each point on the first live run and
rewrite this section with what was seen and the macOS version.

- Create is AppleScript (`osa/create-draft.applescript`) because JXA's
  attachment support in Mail is widely reported broken. Read, list and
  delete are JXA so they can return JSON.
- A draft is made as an `outgoing message` with `visible:false`, recipients
  and attachments are added, then `save` puts it in Drafts. Some reports say
  attachments only survive with `visible:true`; if the live run shows
  `DRAFT_MISMATCH attachments 0 of N`, try that first.
- Mail loads attachments asynchronously and drops any still loading at save
  time. The script polls `count of attachments of content` up to a settle
  budget (`settleMs` in drafts.ts) and then waits 0.5 s more; the core then
  re-reads the saved draft every second for up to 30 s.
- The saved draft is found by diffing the Drafts ids before and after the
  save, filtered by exact subject. That is why `--subject` is required.
- Draft ids are Mail's integer message `id` from `draftsMailbox().messages`.
  For IMAP or Exchange accounts the server sync may replace the local copy
  under a new id; the read-back loop rescans on `DRAFT_NOT_FOUND`, but ids
  shown by `draft list` may still go stale.
- `draftsMailbox()` is the unified Drafts mailbox across accounts. The
  account comes from `m.mailbox().account()`.
- `set sender` must match an account address exactly; the core sends
  `Full Name <address>` when the account has a full name.
- `Mail.delete(m)` on a draft is expected to move it to the account's Trash.
- The outgoing message is not closed after `save`; check whether that leaves
  a stray open compose object or duplicates the draft.
- The error stderr fixtures in `test/errors.test.ts` are shaped after
  osascript's `<path>: execution error: <msg> (<n>)` format, not captured.
  Replace them with verbatim captures.

## Live smoke procedure

Only with the user's approval. With Mail open and a throwaway account:

```sh
APPLE_MAIL_AXI_LIVE=1 pnpm vitest run test/live.smoke.test.ts
```

It creates one draft named `apple-mail-axi-smoke <timestamp>` with a small
text attachment to `smoke@example.com`, reads it back, lists it, views it
and deletes it. If it fails midway, delete the leftover draft by hand in
Mail. Also try each error path once: Mail closed, Automation switched off,
an unknown `--from`.

## Safety rules enforced by tests

- `test/no-send.test.ts` fails if any file in `osa/` mentions sending
  (except the `sender` property), the outbox, delivery, shell scripts,
  reply, forward or redirect, if `osa/` holds a file the runner does not
  know, or if any script text appears in `src/`.
- `test/parity.test.ts` drives the CLI and the MCP server with the same
  inputs against one fake Mail and requires identical output, error codes
  and osascript calls.
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
