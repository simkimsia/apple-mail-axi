# fixtures/

The fixture is a throwaway Mail.app account on a macOS host with exactly 3
drafts whose subjects start with `bench-fixture-`, plus `/fixtures/report.pdf`.
`create.sh` and `destroy.sh` are not written yet (take 1): they must use
plain `osascript` (never apple-mail-axi, so cleanup does not depend on the
code under test) and must never touch any message outside the Drafts mailbox.

Task expectations must be invariant under recreation: counts and subjects,
never draft ids or dates.
