// apple-mail-axi list open outgoing messages (JXA, read-only).
// An outgoing message is a compose window. create-draft opens one and
// closes it; the core uses this list to check that none of ours is left.
// argv: none.
function run(argv) {
  const Mail = Application("Mail");
  if (!Mail.running()) throw new Error("AMA_ERR:MAIL_NOT_RUNNING");
  function attempt(fn, fallback) {
    try {
      const value = fn();
      return value === null || value === undefined ? fallback : value;
    } catch (e) {
      return fallback;
    }
  }
  const rows = Mail.outgoingMessages().map(function (m) {
    return {
      id: String(
        attempt(function () {
          return m.id();
        }, ""),
      ),
      subject: attempt(function () {
        return m.subject();
      }, ""),
    };
  });
  return JSON.stringify({ outgoing: rows });
}
