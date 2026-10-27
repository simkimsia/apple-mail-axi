# apple-mail-axi

An agent-first CLI and MCP server for Apple Mail drafts on macOS.
It saves plain-text drafts with attachments in Mail.app, then lists, views and deletes them.
After every save it reads the draft back from Mail and checks the recipients, subject and attachment count before it reports success.

It never sends mail.
No command or tool can send a message or put one in Mail's outbox, and a test fails the build if any bundled script could.

The CLI follows the [AXI](https://axi.md) principles: token-efficient [TOON](https://toonformat.dev) output, structured errors with a stable `code` and a next step, and definitive empty states.
It is built on [`axi-sdk-js`](https://github.com/kunchenguid/axi) and modeled on [`gh-axi`](https://github.com/kunchenguid/gh-axi).

## Status

v1, take 2. It covers drafts only. Reading and searching mail come in v2.
Offline tests pass. The create path was probed live on one iCloud account; the full smoke test has not run yet. See [STATUS.md](STATUS.md).

## Requirements

- macOS with Mail.app set up with at least one account
- Node.js >= 20
- Mail.app running when you call it (`open -a Mail`)

## Install

```sh
pnpm add -g @simkimsia/apple-mail-axi
```

Or run it without installing: `npx -y @simkimsia/apple-mail-axi --help`.

Check it: `apple-mail-axi --version`. Update later with `apple-mail-axi update`.

To work on it from a clone:

```sh
git clone https://github.com/simkimsia/apple-mail-axi
pnpm -C apple-mail-axi install
pnpm -C apple-mail-axi run build
pnpm add -g link:$PWD/apple-mail-axi   # puts `apple-mail-axi` on PATH
```

## First run: permissions

apple-mail-axi drives Mail through `osascript`, so macOS asks once whether the app that runs it may control Mail.
That app is your terminal for the CLI, or the MCP client (for example Claude) for the MCP server.

- Click **OK** on the prompt "... wants access to control Mail".
- If you clicked **Don't Allow**, commands fail with `AUTOMATION_DENIED`. Fix it in System Settings → Privacy & Security → Automation, then allow the terminal to control Mail.
- If the app is not listed there, run `tccutil reset AppleEvents` and run any command again to get the prompt back.

Drafts need no Full Disk Access.

## A compose window appears during create

`draft create` opens a real Mail compose window, fills it, saves it to Drafts and closes it again without sending.
The window is on screen for a few seconds, longer with attachments.
Do not type into it while it is open.
Mail does not save drafts from hidden compose windows, so there is no invisible mode.
If a create is interrupted and a compose window titled with your subject stays open, close it and choose Don't Save; the error says so (`COMPOSE_LEFT_OPEN`).
apple-mail-axi does not launch Mail for you; if Mail is closed, commands fail with `MAIL_NOT_RUNNING` and tell you to run `open -a Mail`.

## CLI usage

```sh
apple-mail-axi                      # recent drafts
apple-mail-axi draft create --to ana@example.com --cc bo@example.com \
  --subject "Q3 notes" --body "Hi Ana, notes attached." \
  --attach ./notes.pdf --attach ./chart.png --from Work
printf 'Long body\n' | apple-mail-axi draft create --to ana@example.com --subject "Q3" --body-file -
apple-mail-axi draft list [--limit 50]
apple-mail-axi draft view <id> [--full]
apple-mail-axi draft delete <id>
apple-mail-axi draft --help
```

- `--to`, `--cc`, `--bcc` and `--attach` repeat. Addresses are bare (`ana@example.com`).
- The body comes from `--body`, `--body-file <path>`, or stdin with `--body-file -`. It is plain text only.
- `--from` takes a Mail account name or one of its addresses. Leave it out to use Mail's default account.
- `--subject` is required: it is how the saved draft is found again and checked.
- `draft delete` takes the full numeric id from `draft list` and refuses any id that is not in Mail's Drafts mailbox.

Example output:

```
created:
  id: "48213"
  subject: Q3 notes
  from: Kim Sia <kim@work.example>
  account: Work
  to[1]: ana@example.com
  cc[1]: bo@example.com
  bcc: []
  attachments: 2
  verified: "recipients, subject and 2 attachment(s) read back from Mail"
  sent: false
help[2]:
  Run `apple-mail-axi draft view 48213` to check the body
  Open the draft in Mail's Drafts to review and send it yourself
```

Errors go to stdout in the same format, with exit code 1 (2 for a bad call):

| Code                                             | Meaning                                                                      |
| ------------------------------------------------ | ---------------------------------------------------------------------------- |
| `VALIDATION_ERROR`                               | bad flags or values; fix the call (exit 2)                                   |
| `AUTOMATION_DENIED`                              | macOS blocked control of Mail (-1743); see First run above                   |
| `MAIL_NOT_RUNNING`                               | run `open -a Mail`                                                           |
| `MAIL_NOT_SET_UP`                                | Mail has no accounts                                                         |
| `ATTACHMENT_NOT_FOUND` / `ATTACHMENT_UNREADABLE` | the file is missing, a folder, or unreadable                                 |
| `UNKNOWN_SENDER`                                 | `--from` matches no enabled account; the help lists the valid ones           |
| `DRAFT_NOT_FOUND`                                | no draft with that id in Drafts                                              |
| `DRAFT_NOT_SAVED` / `DRAFT_MISMATCH`             | the read-back did not find the draft, or found it different from the request |
| `DELETE_NOT_CONFIRMED`                           | Mail took the delete but the draft is still listed                           |
| `COMPOSE_LEFT_OPEN`                              | a compose window apple-mail-axi opened could not be closed; close it by hand |
| `MAIL_TIMEOUT`                                   | Mail did not answer in time                                                  |
| `UNSUPPORTED_PLATFORM`                           | not macOS                                                                    |

## MCP server

`apple-mail-axi mcp` runs a stdio MCP server with the same four operations as tools: `draft_create`, `draft_list`, `draft_view` and `draft_delete`.
They take the same arguments as the CLI (snake_case: `body_file`) and return the same text and error codes.
The one difference is wording in `help:` next steps: over MCP they name tools and arguments (``Call the `draft_view` tool with `{id: '48213'}` ``) instead of CLI commands.
Stdin (`--body-file -`) is the one CLI-only input; pass `body` instead.

Claude Code:

```sh
claude mcp add apple-mail -- apple-mail-axi mcp
```

Claude Desktop, Cursor or any client that takes a JSON config:

```json
{
  "mcpServers": {
    "apple-mail": {
      "command": "apple-mail-axi",
      "args": ["mcp"]
    }
  }
}
```

Without a global install, use `"command": "npx"` and `"args": ["-y", "@simkimsia/apple-mail-axi", "mcp"]`.
The first tool call triggers the Automation prompt for the client app.

## Agent skill

Install the bundled skill so your coding agent prefers `apple-mail-axi`:

```sh
npx skills add simkimsia/apple-mail-axi --skill apple-mail-axi -g
```

Source: [`skills/apple-mail-axi/SKILL.md`](skills/apple-mail-axi/SKILL.md).

## Development

```sh
pnpm install
pnpm run dev          # run from source (tsx)
pnpm test             # vitest, offline: osascript is stubbed
pnpm run build        # tsc -> dist/
pnpm run format:check
```

The live smoke test creates and deletes one real draft from the iCloud account (override with `APPLE_MAIL_AXI_LIVE_FROM`), checks that no compose window is left open, and runs only when asked:

```sh
APPLE_MAIL_AXI_LIVE=1 pnpm vitest run test/live.smoke.test.ts
```

## Changelog

Release notes live in CHANGELOG.md and on [GitHub Releases](https://github.com/simkimsia/apple-mail-axi/releases) once the first release is cut.
release-please writes both from conventional commits, so do not edit the file by hand.

## License

MIT
