-- apple-mail-axi close compose windows this tool opened (AppleScript).
-- argv: the ids of outgoing messages to close, as decimal integer strings.
-- The core passes only ids that were not open before its own create and
-- that carry the exact subject it asked for, so the user's own compose
-- windows are never touched. Each one is closed without saving; a draft
-- that was already saved stays in Drafts.
on run argv
	if application "Mail" is not running then error "AMA_ERR:MAIL_NOT_RUNNING" number 9001
	set wantedIds to {}
	repeat with rawId in argv
		set end of wantedIds to (contents of rawId) as integer
	end repeat
	tell application "Mail"
		repeat with msgRef in (every outgoing message)
			set m to contents of msgRef
			try
				if wantedIds contains (id of m) then close m saving no
			end try
		end repeat
	end tell
	return "done"
end run
