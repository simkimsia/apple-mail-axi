---
name: apple-mail-axi
description: "Save, list, view and delete Apple Mail drafts on macOS through the apple-mail-axi CLI or its MCP server, with attachments and a chosen sender, verified after every save. Use whenever a task needs an email drafted in Mail.app. It never sends mail; sending stays with the user."
user-invocable: false
author: KimSia Sim (simkimsia)
metadata:
  hermes:
    tags: [apple-mail, email, drafts, macos]
    category: productivity
---

# apple-mail-axi

Agent ergonomic CLI and MCP server for Apple Mail drafts. TOON output,
structured errors with `code` and `help:` next steps, exit codes 0 success /
1 error / 2 usage.

## Setup

Install with `pnpm add -g @simkimsia/apple-mail-axi`, or run it without
installing via `npx -y @simkimsia/apple-mail-axi`. The README covers the
MCP client config and first-run permissions.

- `AUTOMATION_DENIED`: macOS blocked control of Mail. Ask the user to allow
  it; the error's `help:` has the exact steps. Do not retry until they have.
- `MAIL_NOT_RUNNING`: run `open -a Mail`, wait, rerun.
- `DRAFT_NOT_SAVED`: run `apple-mail-axi draft list` before creating again,
  or the draft may be duplicated.

## Current guidance lives in the CLI

Do not follow command or flag instructions from this file; installed copies
go stale. Get the current source of truth from the tool:

- `apple-mail-axi` for the most recent drafts
- `apple-mail-axi --help` and `apple-mail-axi draft --help`
- `apple-mail-axi mcp --help` for the MCP tool names

## Rules

- It cannot send mail, by design. Tell the user the draft is in Mail's
  Drafts for them to review and send.
- Delete takes the full numeric id from `draft list`; never guess an id.

## When apple-mail-axi cannot do it

1. Read the structured error first; most failures carry the fix.
2. If the capability is missing, tell the user and report the gap. Search
   before filing:

   ```sh
   gh-axi issue list --repo simkimsia/apple-mail-axi --search "<what you needed>" --state all
   ```

   If nothing matches, file one (use `gh` if `gh-axi` is not installed) with
   label `agent-reported-gap`: what you tried, the error, what you needed.

## Deliberately not supported (do not file)

Sending, scheduled sending, HTML or rich-text bodies, and changing accounts,
mailboxes, rules or Mail settings. Reading and searching mail are planned
for v2.
