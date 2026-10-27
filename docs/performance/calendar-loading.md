# Calendar startup request ownership

Evidence: supplied Lighthouse 13.5 report (2026-10-27 20:12 UTC), authenticated
calendar navigation: performance 69, FCP 0.4s, LCP 0.6s, TBT 1660ms, 10 long tasks.
The 1353ms largest task is unattributable; the JSON has no execution trace that
would establish its producer. Do not attribute all blocking time to API requests.
The report shows duplicate meeting/inbox/delegation/exclusion/calendar/all-day
requests. Initial document server response is 46ms; asset compression is present.

Code inspection found competing owners: the common Realtime reader requests an
initial snapshot, while month and mount effects independently fetch the same data.
Two legacy Postgres channels also refresh meetings alongside the common reader.

The common reader now owns initial snapshots, user/month changes, reconnection and
invalidation. Separate readers isolate meeting data, calendars/subscriptions and
all-day events. Calendar/subscription changes still reload meetings to reconcile
visibility. User identity and a valid month gate meeting registration. Legacy
channels and duplicate mount/month fetch effects are removed. Explicit refresh and
post-mutation callbacks remain. No date range, authorization or database change.

Validation: production build and 8 targeted tests pass, including execution of the
actual data hook with a mocked database: one request per resource on startup;
month change replaces only the meeting reader. Shared queue tests cover bursts,
reconnection and invalidation. Lint not run. No post-deployment Lighthouse score or
physical-browser timing is claimed. Publish frontend then repeat the same signed-in
Lighthouse navigation to measure residual blocking, using a performance trace if
the largest task remains unattributable.
