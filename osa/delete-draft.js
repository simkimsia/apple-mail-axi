// apple-mail-axi delete one draft (JXA, Drafts mailbox only).
// argv[0]: the full draft id, as a decimal integer string.
// The lookup is scoped to Mail's Drafts mailbox, so an id that belongs to any
// other message is reported as not found and nothing is touched.
function run(argv) {
  const id = parseInt(argv[0], 10);
  const Mail = Application("Mail");
  if (!Mail.running()) throw new Error("AMA_ERR:MAIL_NOT_RUNNING");
  if (Mail.accounts().length === 0) throw new Error("AMA_ERR:MAIL_NOT_SET_UP");
  function attempt(fn, fallback) {
    try {
      const value = fn();
      return value === null || value === undefined ? fallback : value;
    } catch (e) {
      return fallback;
    }
  }
  const found = Mail.draftsMailbox().messages.whose({ id: id })();
  if (found.length === 0) throw new Error("AMA_ERR:DRAFT_NOT_FOUND:" + argv[0]);
  const m = found[0];
  const summary = {
    id: String(id),
    subject: attempt(function () {
      return m.subject();
    }, ""),
    account: attempt(function () {
      return m.mailbox().account().name();
    }, ""),
  };
  Mail.delete(m);
  return JSON.stringify(summary);
}
