# Vision

`apple-mail-axi` is an agent-first CLI and MCP server for Apple Mail on macOS that drafts email with attachments and reads and searches mail.
It drives Mail.app through AppleScript for drafts, wraps the `apple-mail-mcp` CLI for reading, and never sends mail.

## Scope

We aim for a focused drafting and reading tool, not parity with Mail.app.
Drafts are in scope: creating a draft with to, cc, bcc, subject, a plain-text body, attachments and a chosen sender account, and listing, viewing and deleting drafts.
Reply and forward drafts of an existing message are in scope.
Reading is in scope: listing, searching and reading messages and their attachments, provided by running the `apple-mail-mcp` CLI as a separate process.
We accept contributions that make drafting or reading more reliable, more complete, or easier for an agent to call.
We do not add sending, scheduled sending, or any path that hands a message to Mail's outbox.
We do not add HTML or rich-text bodies.
We do not change accounts, mailboxes, rules or Mail settings.
We do not vendor, copy or port code from `apple-mail-mcp`, which is GPL-3.0; we only call its CLI.

## Interface

There are two ways in, the CLI and `apple-mail-axi mcp`, over one core library.
The CLI follows validated AXI principles, optimizes for autonomous agent use, and runs without any server.
`apple-mail-axi mcp` is a stdio MCP server in the same package whose tools call the same core functions as the CLI commands.
Every mail capability is reachable through both ways in, with the same arguments, safety rules and errors.
A change that adds a capability to only one way in, or puts mail logic in the CLI or MCP layer instead of the core, does not align.
Output exists for agent comprehension, not as a stable API for hand-written parsers.
Errors carry a stable code and a next step the caller can act on.
Missing Automation or Full Disk Access permission, a missing `apple-mail-mcp` install, and Mail.app not running each get their own error with the exact fix.

## Safety

Read commands are the default and never change mailbox state, including read, flagged and mailbox location.
Write commands only create, change or delete drafts, are named as verbs, and print what changed.
A draft write reports success only after reading the draft back from Mail.app and confirming its recipients, subject and attachment count.
Delete takes a draft id named in full and refuses any message that is not a draft.
No command infers its target from context.
Every value passed to AppleScript goes through `osascript` argv and is never interpolated into script text.
