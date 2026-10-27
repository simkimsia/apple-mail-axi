/**
 * TOON renderers shared by the CLI and the MCP server, so both ways in print
 * the same output for the same result. No mail logic here.
 */
import { AxiError } from "./core/errors.js";
import type {
  CreateDraftResult,
  DeleteDraftResult,
  DraftDetail,
  DraftRow,
  ListDraftsResult,
  ViewDraftResult,
} from "./core/drafts.js";
import {
  encode,
  renderHelp,
  renderList as toonList,
  renderOutput,
  Truncator,
} from "./toon.js";

export const BODY_PREVIEW = 1500;
const SUBJECT_MAX = 80;

function recipients(list: string[]): string {
  if (list.length === 0) return "";
  return list.length === 1 ? list[0] : `${list[0]} +${list.length - 1}`;
}

export function draftRows(rows: DraftRow[]): Record<string, unknown>[] {
  const t = new Truncator(false);
  return rows.map((r) => ({
    id: r.id,
    subject: t.cut(r.subject || "(no subject)", SUBJECT_MAX),
    to: recipients(r.to),
    attachments: r.attachments,
  }));
}

function detail(
  d: DraftDetail,
  full: boolean,
): { block: string; cut: boolean } {
  const t = new Truncator(full);
  const body = d.body ?? "";
  const shown =
    full || body.length <= BODY_PREVIEW
      ? body
      : `${body.slice(0, BODY_PREVIEW)}… (truncated, ${body.length} chars total)`;
  if (!full && body.length > BODY_PREVIEW) t.count++;
  const block = encode({
    draft: {
      id: d.id,
      subject: d.subject,
      from: d.from,
      to: d.to,
      cc: d.cc,
      bcc: d.bcc,
      account: d.account,
      mailbox: d.mailbox,
      date: d.date,
      attachments: d.attachments.map((a) => ({ name: a.name, size: a.size })),
      body: shown,
    },
  });
  return { block, cut: t.count > 0 };
}

export function renderCreate(r: CreateDraftResult): string {
  const d = r.draft;
  return renderOutput([
    encode({
      created: {
        id: d.id,
        subject: d.subject,
        from: d.from,
        account: d.account,
        to: d.to,
        cc: d.cc,
        bcc: d.bcc,
        attachments: d.attachments.length,
        verified: `recipients, subject and ${d.attachments.length} attachment(s) read back from Mail`,
        sent: false,
      },
    }),
    renderHelp([
      `Run \`apple-mail-axi draft view ${d.id}\` to check the body`,
      "Open the draft in Mail's Drafts to review and send it yourself",
    ]),
  ]);
}

export function renderListResult(r: ListDraftsResult): string {
  if (r.total === 0) {
    return renderOutput([
      "drafts: 0 drafts in Mail's Drafts mailbox",
      renderHelp([
        'Run `apple-mail-axi draft create --to <address> --subject "<subject>" --body "<text>"` to save one',
      ]),
    ]);
  }
  const shown = r.drafts.length;
  return renderOutput([
    `count: ${shown} of ${r.total} total`,
    renderListBlock(r.drafts),
    renderHelp([
      "Run `apple-mail-axi draft view <id>` for recipients, attachments and the body",
      ...(shown < r.total
        ? [
            `Run \`apple-mail-axi draft list --limit ${r.total}\` for all ${r.total} drafts`,
          ]
        : []),
    ]),
  ]);
}

function renderListBlock(rows: DraftRow[]): string {
  return toonList("drafts", draftRows(rows));
}

export function renderView(r: ViewDraftResult): string {
  const { block, cut } = detail(r.draft, r.full);
  return renderOutput([
    block,
    ...(cut
      ? [
          renderHelp([
            `Run \`apple-mail-axi draft view ${r.draft.id} --full\` for the whole body`,
          ]),
        ]
      : []),
  ]);
}

export function renderDelete(r: DeleteDraftResult): string {
  return renderOutput([
    encode({
      deleted: {
        id: r.id,
        subject: r.subject,
        account: r.account,
        note: "removed from Drafts; Mail keeps deleted messages in the account's Trash",
      },
    }),
  ]);
}

export const RENDERERS: Record<string, (result: never) => string> = {
  draft_create: renderCreate as (r: never) => string,
  draft_list: renderListResult as (r: never) => string,
  draft_view: renderView as (r: never) => string,
  draft_delete: renderDelete as (r: never) => string,
};

/** The structured error both ways in print. */
export function renderError(error: AxiError): string {
  return `${encode({
    error: error.message,
    code: error.code,
    ...(error.suggestions.length > 0 ? { help: error.suggestions } : {}),
  })}\n`;
}
