// apple-mail-axi preflight (JXA, read-only).
// Returns Mail's accounts and the ids currently in the Drafts mailbox.
// argv: none.
function run(argv) {
  const Mail = Application("Mail");
  // running() never launches Mail; we refuse rather than start it.
  if (!Mail.running()) throw new Error("AMA_ERR:MAIL_NOT_RUNNING");
  const accounts = Mail.accounts();
  if (accounts.length === 0) throw new Error("AMA_ERR:MAIL_NOT_SET_UP");
  function attempt(fn, fallback) {
    try {
      const value = fn();
      return value === null || value === undefined ? fallback : value;
    } catch (e) {
      return fallback;
    }
  }
  const rows = accounts.map(function (a) {
    return {
      name: attempt(function () {
        return a.name();
      }, ""),
      fullName: attempt(function () {
        return a.fullName();
      }, ""),
      addresses: attempt(function () {
        return a.emailAddresses();
      }, []),
      enabled: attempt(function () {
        return a.enabled();
      }, true),
    };
  });
  const ids = Mail.draftsMailbox().messages.id();
  return JSON.stringify({
    accounts: rows,
    draftIds: ids.map(function (id) {
      return String(id);
    }),
  });
}
