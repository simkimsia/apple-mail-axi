// apple-mail-axi list drafts (JXA, read-only, Drafts mailbox only).
// argv[0]: "ids" (id + subject for every draft) or "rows" (summary rows).
// argv[1]: maximum number of rows, as a decimal integer string.
function run(argv) {
  const mode = argv[0];
  const limit = parseInt(argv[1], 10);
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
  const box = Mail.draftsMailbox();
  const ids = box.messages.id();
  const subjects = box.messages.subject();
  if (mode === "ids") {
    return JSON.stringify({
      total: ids.length,
      drafts: ids.map(function (id, i) {
        return { id: String(id), subject: subjects[i] || "" };
      }),
    });
  }
  // Highest id first: Mail hands out increasing ids, so this is newest first.
  const order = ids
    .map(function (id, i) {
      return { id: id, i: i };
    })
    .sort(function (x, y) {
      return y.id - x.id;
    })
    .slice(0, limit);
  const rows = order.map(function (entry) {
    const m = box.messages[entry.i];
    const when =
      attempt(function () {
        return m.dateSent();
      }, null) ||
      attempt(function () {
        return m.dateReceived();
      }, null);
    return {
      id: String(entry.id),
      subject: subjects[entry.i] || "",
      to: attempt(function () {
        return m.toRecipients.address();
      }, []),
      attachments: attempt(function () {
        return m.mailAttachments().length;
      }, 0),
      account: attempt(function () {
        return m.mailbox().account().name();
      }, ""),
      date: when ? when.toISOString() : "",
    };
  });
  return JSON.stringify({ total: ids.length, drafts: rows });
}
