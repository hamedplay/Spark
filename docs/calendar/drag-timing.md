# Calendar drag and timing notifications

The calendar card rendered exact minute positions but initialized drag/resize anchors through a half-hour rounding function. A 09:15–10:00 meeting therefore acquired 09:30–10:00 anchors, changing its duration when moved. Move/resize anchors now use the same exact fractional slots as rendering; existing pointer delta snapping stays unchanged.

Move/resize persistence previously checked only the HTTP error on a filtered UPDATE. A zero-row update could appear successful. Both paths now require one returned row with explicit start/end and update the visible meeting from that persisted record. No notification is generated after a rejected/empty save. The confirmation dialog shows old and proposed date/time.

The client change-notification placeholder builder supplied `meeting_time` but omitted `start_time` and `end_time`, and move/resize notifications omitted `meetingId`. This matches the reported observer SMS failures and `MEETING_ID_NOT_LOGGED`. Both explicit times and the exact meeting ID now accompany those notifications. Existing server-managed series routing remains authoritative. Resolved notification results with `ok:false` now produce the partial-notification warning rather than a success toast.

Validation: focused calendar tests exercise actual commit bodies for move and resize, failed/empty persistence, persisted times in observer/participant notifications, the real SMS renderer, and quarter-hour drag anchors. Build passes; no lint. The connected copy's meeting columns/triggers were inspected; this change needs no database migration. The reported production SMS failures are historical and are not resent automatically. Deploy the frontend and validate a fresh drag/save; provider receipt has not been tested on production.
