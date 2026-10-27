-- apple-mail-axi create one draft (AppleScript).
-- Every value arrives through argv; nothing is spliced into this text.
-- The message is saved to Drafts and its compose window is LEFT OPEN on
-- success: the core reads the saved draft back while the window is still
-- open, then closes it without saving (osa/discard-outgoing.applescript).
-- On any error after the message is made, this script closes it itself.
--
-- Path confirmed live on 2026-10-27 (macOS Darwin 24.6.0, iCloud): a
-- visible compose, parts added, a pause, save, then close saving no. The
-- saved draft survives the close. A hidden compose (visible:false) never
-- reached Drafts and could not be closed, so it is not used.
-- Live run 2 (same day): closing the window right after `save` dropped the
-- attachment from the saved draft; with the window kept open for 3 s after
-- `save` it stayed. `save` returns before Mail has written the attachment,
-- so this script must not close the window after a successful save.
--
-- argv layout (built by src/core/drafts.ts buildCreateArgv):
--   1 subject, 2 body, 3 sender ("" = Mail's default),
--   4 attachment settle budget ms, 5 pause before save ms,
--   then four counted lists: to, cc, bcc, attachment POSIX paths,
--   each as <count> followed by <count> items.
--
-- Note: `left` is a reserved word in AppleScript; do not use it as a name.

on takeList(argv, startIndex)
	set n to (item startIndex of argv) as integer
	set values to {}
	repeat with k from 1 to n
		set end of values to item (startIndex + k) of argv
	end repeat
	return {values, startIndex + n + 1}
end takeList

-- Close our own compose window without saving (error path only). Never raises.
on discardMessage(theMessage)
	if theMessage is missing value then return
	try
		tell application "Mail" to close theMessage saving no
	end try
end discardMessage

on run argv
	set theSubject to item 1 of argv
	set theBody to item 2 of argv
	set theSender to item 3 of argv
	set settleSeconds to ((item 4 of argv) as integer) / 1000
	set pauseSeconds to ((item 5 of argv) as integer) / 1000
	set {toList, nextIndex} to takeList(argv, 6)
	set {ccList, nextIndex} to takeList(argv, nextIndex)
	set {bccList, nextIndex} to takeList(argv, nextIndex)
	set {fileList, nextIndex} to takeList(argv, nextIndex)

	if application "Mail" is not running then error "AMA_ERR:MAIL_NOT_RUNNING" number 9001
	tell application "Mail"
		if (count of accounts) is 0 then error "AMA_ERR:MAIL_NOT_SET_UP" number 9002
	end tell

	set draftMessage to missing value
	try
		tell application "Mail"
			set draftMessage to make new outgoing message with properties {subject:theSubject, content:theBody, visible:true}
			if theSender is not "" then set sender of draftMessage to theSender
			tell draftMessage
				repeat with addr in toList
					make new to recipient at end of to recipients with properties {address:(contents of addr)}
				end repeat
				repeat with addr in ccList
					make new cc recipient at end of cc recipients with properties {address:(contents of addr)}
				end repeat
				repeat with addr in bccList
					make new bcc recipient at end of bcc recipients with properties {address:(contents of addr)}
				end repeat
			end tell
			repeat with filePath in fileList
				try
					tell content of draftMessage
						make new attachment with properties {file name:(POSIX file (contents of filePath))} at after last paragraph
					end tell
				on error
					error "AMA_ERR:ATTACHMENT_REJECTED:" & (contents of filePath) number 9003
				end try
			end repeat

			-- Mail loads attachments asynchronously and drops any that are still
			-- loading at save time, so wait for them to register before saving.
			set wantedCount to count of fileList
			if wantedCount > 0 then
				set waitedSeconds to 0
				repeat while waitedSeconds < settleSeconds
					set attachedCount to 0
					try
						set attachedCount to count of attachments of content of draftMessage
					end try
					if attachedCount >= wantedCount then exit repeat
					delay 0.25
					set waitedSeconds to waitedSeconds + 0.25
				end repeat
			end if
			delay pauseSeconds

			save draftMessage
		end tell
	on error errText number errNum
		my discardMessage(draftMessage)
		error errText number errNum
	end try

	-- Saved. Do not close here: Mail is still writing attachments into the
	-- saved draft. The core verifies the draft, then closes this window.
	return "saved"
end run
