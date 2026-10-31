# Realtime subscription and Push initialization repair

The production trace reported `realtime.subscription.subscription_id` missing.
The supplied catalog query confirmed the original six-column subscription table:
`id, user_id, email, entity, filters, created_at`. The running service instead
inserts `subscription_id, claims, action_filter, selected_columns`, and its filter
type already contains the current `negate` attribute. Both VAPID keys were also
unreadable. These are two separate causes, not a console logging problem.

Migration `20261031035922_repair_console_realtime_subscription_and_push_initialization.sql`
repairs only that exact legacy table shape. It first requires the current
`apply_rls` function and filter type; unsupported combinations fail atomically
with an explicit migration error. The migration clears transient socket
subscription bookkeeping, renames `user_id`, adds the claims/generated role and
action/select columns, installs the corresponding unique index and validates
filters/selected columns against the claimed role's column privileges. Its
validator follows the inspected working Realtime implementation and the official
tenant subscription migrations. Existing healthy subscription tables are skipped.
Notification records, meetings and user accounts are not cleared.

The authenticated Push reader retains its FULL-session gate and public-key-only
contract. Missing/unreadable keys now return `{configured: false, publicKey: null}`
instead of the expected initialization state becoming an HTTP 400. The browser
then calls the existing authenticated `pwa-push-config` endpoint, which generates
the VAPID pair server-side. Normal configured reads still use the session RPC.

The service-only VAPID setter now serializes initializers with an advisory lock
and preserves an already readable pair. Both server callers read back the stored
pair after initialization, so a concurrent generated candidate is never returned
or used as though it had been stored. A partial/unreadable pair is repaired as a
pair. Private keys remain server-side; users cannot execute the setter. The Push
worker still checks its dedicated Vault token before accessing its outbox.

Apply the new migration on the actual database, then run **Update Internet App**
to install the frontend and both updated Push functions. Existing channels can
reconnect after the schema repair. A migration applied only to the connected test
project does not repair the production database. There is no console-error filter
or replacement of Postgres Changes with polling in this repair.

Validation: the new migration applied to the connected non-production project;
catalog readback confirmed the public reader's FULL gate, initialization state,
setter lock and service-only write grants. Its healthy Realtime table was kept.
The production build passed. No lint, test suite, health probe or actual browser
Push/SMS delivery was run. The legacy repair branch has not been executed on the
production database from this session.
Both updated Push functions deployed as ACTIVE in the test project. Its worker
token remains unset and the existing 213 pending Push rows were retained.
