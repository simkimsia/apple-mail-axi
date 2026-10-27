// apple-mail-axi view one draft (JXA, read-only, Drafts mailbox only).
// argv[0]: the draft id, as a decimal integer string.
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
  // Only the Drafts mailbox is searched, so a non-draft id is never found.
  const found = Mail.draftsMailbox().messages.whose({ id: id })();
  if (found.length === 0) throw new Error("AMA_ERR:DRAFT_NOT_FOUND:" + argv[0]);
  const m = found[0];
  const when =
    attempt(function () {
      return m.dateSent();
    }, null) ||
    attempt(function () {
      return m.dateReceived();
    }, null);
  const files = attempt(function () {
    return m.mailAttachments();
  }, []);
  return JSON.stringify({
    id: String(id),
    subject: attempt(function () {
      return m.subject();
    }, ""),
    from: attempt(function () {
      return m.sender();
    }, ""),
    to: attempt(function () {
      return m.toRecipients.address();
    }, []),
    cc: attempt(function () {
      return m.ccRecipients.address();
    }, []),
    bcc: attempt(function () {
      return m.bccRecipients.address();
    }, []),
    account: attempt(function () {
      return m.mailbox().account().name();
    }, ""),
    mailbox: attempt(function () {
      return m.mailbox().name();
    }, ""),
    date: when ? when.toISOString() : "",
    attachments: files.map(function (f) {
      return {
        name: attempt(function () {
          return f.name();
        }, ""),
        size: attempt(function () {
          return f.fileSize();
        }, 0),
      };
    }),
    body: attempt(function () {
      return m.content();
    }, ""),
  });
}
