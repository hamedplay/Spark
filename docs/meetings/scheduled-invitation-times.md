# Prevent scheduled invitations without an end time

Observed production failure: `SMS_TEMPLATE_CONTEXT_MISSING: end_time` on meeting
`invite` dispatches. The linked meetings existed and were `archived / scheduled`,
with start times but empty `end_time`, `duration` and `request_duration`. There is no
reliable duration from which to recover an end time.

The renderer already reads `meetings.end_time` to enrich missing SMS context; it
correctly rejected these incomplete records before any provider was selected.
`CalendarMeetingForm.handleSubmit` persisted `scheduled` unconditionally and did
not validate its time pair. Its manual time fields were not required, and the
editor was collapsed when an existing incomplete meeting already had a date.
The separate request-record builder, in contrast, only schedules a complete pair.

The fix is limited to calendar schedule creation/editing:

- Validate both explicit times before loading/persistence, conference creation or
  notification dispatch. Accept HH:mm and database time strings with seconds;
  preserve existing overnight schedules and midnight.
- Expose the manual editor whenever either time is missing. Keep the known date
  and start visible, and require both time inputs.
- Keep SMS placeholder validation strict. No assumed end time, template rewrite,
  database backfill, history mutation or automatic SMS retry.

Existing incomplete meetings require a real end time entered in the calendar
editor. Correcting the frontend cannot infer historical times or retroactively
change failed SMS records. Redeploy the frontend using the ordinary application
update path; no schema change or migration is needed.

Validation: `node --import tsx --test tests/meetings/calendarScheduleTimes.test.ts
 tests/meetings/buildMeetingPersistenceRecord.test.ts
 tests/meetings/recurringSmsTransport.test.ts` (on one shell line). These verify
real submit-handler rejection, rendered required inputs, existing request behavior,
strict SMS enrichment and internal/external SMS transport. No live SMS is sent.
