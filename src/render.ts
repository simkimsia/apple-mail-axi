/**
 * TOON renderers shared by the CLI and the MCP server, so both ways in print
 * the same output for the same result. No mail logic here.
 */
import { AxiError, call, type Step } from "./core/errors.js";
import { renderSteps, type Transport } from "./core/steps.js";
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

export function renderCreate(
  r: CreateDraftResult,
  t: Transport = "cli",
): string {
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
    help(
      [
        [call("draft_view", { id: d.id }), " to check the body"],
        "Open the draft in Mail's Drafts to review and send it yourself",
      ],
      t,
    ),
  ]);
}

/** The empty-Drafts next step, shared by draft list and the CLI home view. */
export const CREATE_ONE: Step = [
  call("draft_create", {
    to: ["<address>"],
    subject: "<subject>",
    body: "<text>",
  }),
  " to save one",
];

/** Render next steps for one way in. */
export function help(steps: Step[], t: Transport): string {
  return renderHelp(renderSteps(steps, t));
}

export function renderListResult(
  r: ListDraftsResult,
  t: Transport = "cli",
): string {
  if (r.total === 0) {
    return renderOutput([
      "drafts: 0 drafts in Mail's Drafts mailbox",
      help([CREATE_ONE], t),
    ]);
  }
  const shown = r.drafts.length;
  return renderOutput([
    `count: ${shown} of ${r.total} total`,
    renderListBlock(r.drafts),
    help(
      [
        [
          call("draft_view", { id: "<id>" }),
          " for recipients, attachments and the body",
        ],
        ...(shown < r.total
          ? [
              [
                call("draft_list", { limit: r.total }),
                ` for all ${r.total} drafts`,
              ],
            ]
          : []),
      ],
      t,
    ),
  ]);
}

function renderListBlock(rows: DraftRow[]): string {
  return toonList("drafts", draftRows(rows));
}

export function renderView(r: ViewDraftResult, t: Transport = "cli"): string {
  const { block, cut } = detail(r.draft, r.full);
  return renderOutput([
    block,
    ...(cut
      ? [
          help(
            [
              [
                call("draft_view", { id: r.draft.id, full: true }),
                " for the whole body",
              ],
            ],
            t,
          ),
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

type Renderer = (result: never, t: Transport) => string;

export const RENDERERS: Record<string, Renderer> = {
  draft_create: renderCreate as Renderer,
  draft_list: renderListResult as Renderer,
  draft_view: renderView as Renderer,
  draft_delete: renderDelete as Renderer,
};

/** Anything thrown with a code: ours (steps) or axi-sdk-js's (suggestions). */
export interface CodedError {
  message: string;
  code: string;
  steps?: Step[];
  suggestions?: string[];
}

/** Next steps of an error, worded for one way in. */
export function errorHelp(error: CodedError, t: Transport): string[] {
  if (error instanceof AxiError) return renderSteps(error.steps, t);
  return error.steps
    ? renderSteps(error.steps, t)
    : [...(error.suggestions ?? [])];
}

/**
 * The structured error both ways in print. Same message, code and number of
 * steps on either way in; commands are worded as CLI commands or MCP tools.
 */
export function renderError(error: CodedError, t: Transport): string {
  const steps = errorHelp(error, t);
  return `${encode({
    error: error.message,
    code: error.code,
    ...(steps.length > 0 ? { help: steps } : {}),
  })}\n`;
}
