from pathlib import Path

commit = Path('src/components/CalendarMeetingForm/commitEdit.ts')
text = commit.read_text()
old = """    const bulkMeetingDetails = new Map<string, {\n      subject: string;\n      request_date: string;\n      start_time: string | null;\n      end_time: string | null;\n    }>();\n"""
new = """    const externalInformeesByMeetingId = new Map<string, string[]>();\n    const meetingIdsForInformees = meetingDiffs.map(diff => diff.meeting_id);\n    if (meetingIdsForInformees.length > 0) {\n      const { data: informeeMeetings, error: informeeMeetingsError } = await supabase\n        .from('meetings')\n        .select('id, external_informees')\n        .in('id', meetingIdsForInformees);\n      if (informeeMeetingsError) throw informeeMeetingsError;\n      for (const meeting of informeeMeetings || []) {\n        const row = meeting as { id: string; external_informees?: string[] | null };\n        externalInformeesByMeetingId.set(row.id, Array.isArray(row.external_informees) ? row.external_informees : []);\n      }\n    }\n\n    const bulkMeetingDetails = new Map<string, {\n      subject: string;\n      request_date: string;\n      start_time: string | null;\n      end_time: string | null;\n    }>();\n"""
if text.count(old) != 1:
    raise SystemExit(f'commitEdit bulk marker mismatch: {text.count(old)}')
text = text.replace(old, new, 1)

old = """        if (externalDiff.removed.length > 0) {\n          const cancelFallback = `لغو دعوت: جلسه «${meetingSubject}» در تاریخ ${jalaliDate || meetingDateStr} لغو شد.`;\n          externalSmsResults.push(await sendSmsToExternals(\n            externalDiff.removed,\n            contacts,\n            cancelFallback,\n            userId,\n            currentPlaceholders,\n            'cancel',\n            diff.meeting_id,\n            `${operationId}:${diff.meeting_id}:external:cancel`,\n          ));\n        }\n"""
new = """        if (externalDiff.removed.length > 0) {\n          const cancelFallback = `لغو دعوت: جلسه «${meetingSubject}» در تاریخ ${jalaliDate || meetingDateStr} لغو شد.`;\n          externalSmsResults.push(await sendSmsToExternals(\n            externalDiff.removed,\n            contacts,\n            cancelFallback,\n            userId,\n            currentPlaceholders,\n            'cancel',\n            diff.meeting_id,\n            `${operationId}:${diff.meeting_id}:external:cancel`,\n          ));\n        }\n\n        const externalInformees = externalInformeesByMeetingId.get(diff.meeting_id) || [];\n        if (!isFirstSchedule && (meetingChangeSet?.importantFields.length ?? 0) > 0 && externalInformees.length > 0) {\n          const informeeChangeFallback = `تغییر جلسه: «${meetingSubject}» | تاریخ: ${jalaliDate || meetingDateStr} | ساعت: ${currentTime}${currentPlaceholders.location_part}`;\n          externalSmsResults.push(await sendSmsToExternals(\n            externalInformees,\n            contacts,\n            informeeChangeFallback,\n            userId,\n            currentPlaceholders,\n            'informee_change',\n            diff.meeting_id,\n            `${operationId}:${diff.meeting_id}:external-informee:change`,\n          ));\n        }\n"""
if text.count(old) != 1:
    raise SystemExit(f'commitEdit external marker mismatch: {text.count(old)}')
commit.write_text(text.replace(old, new, 1))

calendar = Path('src/components/Calendar/useCalendarDataActions.ts')
text = calendar.read_text()
start_marker = "      const sendExternalCancel = async (m: MeetingData) => {"
end_marker = "\n\n      // Helper: send cancel notification"
start = text.find(start_marker)
end = text.find(end_marker, start)
if start < 0 or end < 0:
    raise SystemExit('calendar external cancel markers missing')
replacement = """      const sendExternalCancel = async (m: MeetingData) => {\n        let externalNames = (m.external_participants || []) as string[];\n        let externalInformeeNames = ((m as MeetingData & { external_informees?: string[] | null }).external_informees || []) as string[];\n\n        if (m.id && (!externalNames.length || !externalInformeeNames.length)) {\n          const { data: freshMeeting, error: freshMeetingError } = await supabase\n            .from('meetings')\n            .select('external_participants, external_informees')\n            .eq('id', m.id)\n            .maybeSingle();\n          if (freshMeetingError) throw freshMeetingError;\n          if (!externalNames.length) externalNames = (freshMeeting?.external_participants || []) as string[];\n          if (!externalInformeeNames.length) {\n            externalInformeeNames = ((freshMeeting as { external_informees?: string[] | null } | null)?.external_informees || []) as string[];\n          }\n        }\n\n        if (!externalNames.length && !externalInformeeNames.length) return;\n\n        const { data: contacts, error: contactsError } = await supabase\n          .from('contacts_email')\n          .select('name, phone')\n          .eq('user_id', user.id);\n        if (contactsError) throw contactsError;\n\n        const participantNames = new Set(externalNames.map(normalizeExternalName));\n        externalInformeeNames = externalInformeeNames.filter(name => !participantNames.has(normalizeExternalName(name)));\n\n        const sendGroup = async (names: string[], eventType: 'cancel' | 'informee_cancel', errorText: string) => {\n          if (!names.length) return;\n          const wantedNames = new Set(names.map(normalizeExternalName));\n          const mobiles = Array.from(new Set(\n            (contacts || [])\n              .filter((contact: any) => wantedNames.has(normalizeExternalName(contact.name || '')))\n              .map((contact: any) => String(contact.phone || '').trim())\n              .filter(Boolean)\n          ));\n          if (!mobiles.length) return;\n\n          const { data: smsResult, error: smsError } = await supabase.functions.invoke('send-sms', {\n            body: {\n              mode: 'external',\n              mobiles,\n              meetingId: m.id,\n              category: 'meeting',\n              eventType,\n              eventKey: `${m.id}:external:${eventType}`,\n              triggeredByUserId: user.id,\n            },\n          });\n          if (smsError) throw smsError;\n          if (smsResult?.ok === false) throw new Error(smsResult?.error || errorText);\n        };\n\n        await sendGroup(externalNames, 'cancel', 'ارسال لغو جلسه برای شرکت‌کنندگان خارج سازمان ناموفق بود');\n        await sendGroup(externalInformeeNames, 'informee_cancel', 'ارسال لغو جلسه برای مطلعین خارج سازمان ناموفق بود');\n      };"""
text = text[:start] + replacement + text[end:]

replacements = [
    (
        ".select('subject, location, representative, phone, notes, priority, participant_user_ids, notify_users, external_participants, meeting_manager')",
        ".select('subject, location, representative, phone, notes, priority, participant_user_ids, notify_users, external_participants, external_informees, meeting_manager')",
    ),
    (
        "              external_participants: fullMtg.external_participants ?? [],\n              meeting_manager",
        "              external_participants: fullMtg.external_participants ?? [],\n              external_informees: (fullMtg as any).external_informees ?? [],\n              meeting_manager",
    ),
    (
        ".select('id,subject,participant_user_ids,notify_users,external_participants,request_date,start_time,end_time')",
        ".select('id,subject,participant_user_ids,notify_users,external_participants,external_informees,request_date,start_time,end_time')",
    ),
]
for old, new in replacements:
    if text.count(old) != 1:
        raise SystemExit(f'calendar marker mismatch: {old[:60]} count={text.count(old)}')
    text = text.replace(old, new, 1)
calendar.write_text(text)
