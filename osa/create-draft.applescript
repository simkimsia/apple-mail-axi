-- apple-mail-axi create one draft (AppleScript).
-- Every value arrives through argv; nothing is spliced into this text.
-- The message is saved to Drafts and left there. This script has no other
-- way out for the message.
--
-- argv layout (built by src/core/drafts.ts buildCreateArgv):
--   1 subject, 2 body, 3 sender ("" = Mail's default), 4 settle ms,
--   then four counted lists: to, cc, bcc, attachment POSIX paths,
--   each as <count> followed by <count> items.

on takeList(argv, startIndex)
	set n to (item startIndex of argv) as integer
	set values to {}
	repeat with k from 1 to n
		set end of values to item (startIndex + k) of argv
	end repeat
	return {values, startIndex + n + 1}
end takeList

on run argv
	set theSubject to item 1 of argv
	set theBody to item 2 of argv
	set theSender to item 3 of argv
	set settleSeconds to ((item 4 of argv) as integer) / 1000
	set {toList, nextIndex} to takeList(argv, 5)
	set {ccList, nextIndex} to takeList(argv, nextIndex)
	set {bccList, nextIndex} to takeList(argv, nextIndex)
	set {fileList, nextIndex} to takeList(argv, nextIndex)

	if application "Mail" is not running then error "AMA_ERR:MAIL_NOT_RUNNING" number 9001

	tell application "Mail"
		if (count of accounts) is 0 then error "AMA_ERR:MAIL_NOT_SET_UP" number 9002
		set draftMessage to make new outgoing message with properties {subject:theSubject, content:theBody, visible:false}
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
			on error errText
				error "AMA_ERR:ATTACHMENT_REJECTED:" & (contents of filePath) number 9003
			end try
		end repeat

		-- Mail loads attachments asynchronously and drops any that are still
		-- loading at save time, so wait for them to register before saving.
		set wanted to count of fileList
		if wanted > 0 then
			set waited to 0
			repeat while waited < settleSeconds
				set present to 0
				try
					set present to count of attachments of content of draftMessage
				end try
				if present >= wanted then exit repeat
				delay 0.25
				set waited to waited + 0.25
			end repeat
			delay 0.5
		end if

		save draftMessage
	end tell
	return "saved"
end run
