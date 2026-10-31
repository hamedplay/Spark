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

## Follow-up for the reported mixed schema on Realtime 2.134.10

The production follow-up returned `REALTIME_TENANT_FUNCTION_MIGRATIONS_REQUIRED`.
Its catalog showed that `apply_rls` still reads `user_id/email` and returns a
single `wal_rls`, while `list_changes` and the four-field filter type are newer.
`wal_column` still has its original five fields. The vendor migration history
contains only the twelve migrations through `20211202204605`. The running release
was then confirmed as **2.134.10** from `/app/releases/start_erl.data`.

The first repair deliberately stopped before truncation or table alterations;
its assumption that the remaining WAL helpers were current did not hold here.
Keep that migration unchanged. On this affected database, apply
**`20261031042001_repair_mixed_realtime_v213410_postgres_changes.sql` first**, then
retry **`20261031035922_repair_console_realtime_subscription_and_push_initialization.sql`**.
Use the normal migration history mechanism for each successfully applied file.
A chronological runner must apply this prerequisite explicitly before retrying
the blocked older migration; do not mark the failed migration as applied.

The new prerequisite accepts only the exact reported legacy table and composite
type shapes. It clears transient subscriptions, repairs the subscription identity
and claims/action/select columns, replaces the old `wal_column` with its six-field
definition, and replaces the known WAL/filter helpers using SQL from the official
[v2.134.10 tag](https://github.com/supabase/realtime/tree/v2.134.10/lib/realtime/tenants/repo/migrations)
(commit `ef866244e88428bbd286f3e4ac88eb5e54a41bd4`). This includes SETOF WAL results,
action/selected-column routing, negate-aware filters and the per-recipient role
reset. Unknown type dependencies fail atomically: the repair does not use
`DROP ... CASCADE`. Recreated helpers are executable by the Realtime admin role;
application roles cannot access the subscription table or these internal helpers.
Already modern subscription tables skip the entire repair, preserving their
newer helper implementations and active subscriptions.

After both files commit, restart only the existing Realtime container so clients
reconnect and register fresh subscriptions:

```sh
docker restart realtime-dev.supabase-realtime
```

Then run **Update Internet App** to install the frontend/Push function changes
described below. Updating the application alone does not apply database SQL.
The repair leaves `realtime.schema_migrations` and tenant migration counters
unchanged. Reconcile that vendor migration state before a future Realtime runtime
upgrade; this targeted Postgres Changes repair does not establish a complete
vendor migration history.

Validation of the prerequisite: reproduced the supplied legacy schema/functions
in an isolated PostgreSQL-compatible PGlite instance, reproduced the original
guard error, applied the new SQL, and checked the runtime's conflict target,
14-recipient RLS fan-out, negated filters, action routing and hidden-column
protection. Reapplication preserved subscriptions and function definitions, and
the older repair's Realtime block then completed. The migration also applied on
the connected non-production Supabase project, preserving its existing modern
helpers and 213 pending Push rows. No production database change or live socket
delivery has been performed from this session. Temporary validation tooling was
removed; no lint, HTTP health probe or external notification was run.

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

## VAPID_CONFIG_WRITE_FAILED follow-up

The supplied POST response now identifies the service-only VAPID write RPC as
the failing stage. The inspected Vault 0.3.1 `update_secret` implementation
initializes a local variable by decrypting the existing secret before it writes
the replacement. Consequently the prior setter cannot overwrite an existing
unreadable ciphertext, even though the caller supplies a complete new value.
The production SQLSTATE/ciphertext error was not supplied; the confirmed HTTP
error alone does not exclude other database write failures.

New migration `20261031045354_repair_unreadable_pwa_vapid_secret_pair.sql`
replaces only `set_pwa_vapid_config_service(text,text)`. It retains the advisory
lock and an already complete readable pair. For a missing, partial or unreadable
pair it deletes only the two named VAPID secrets and recreates both through
`vault.create_secret`, then verifies their readback. Failure of either write or
verification rolls the whole call back, restoring the original rows. Private
keys remain server-side and only `service_role` can execute the setter.

Applying this migration does not itself generate or rotate any keys. The next
authenticated initializer or existing Push worker supplies the replacement pair
through its existing RPC call. Apply this standalone migration on the actual
database and reload the application. The existing frontend detects a changed
public key and replaces its browser subscription. Preserve Vault's encryption
key when transferring databases to keep existing VAPID keys readable.

Validation used the inspected setter and Vault create/update SQL in isolated
PGlite, with a controlled crypto boundary that raises on unreadable ciphertext.
It reproduced the old failure and verified replacement, healthy-pair preservation,
unrelated-secret preservation, partial-pair recovery, rollback when the second
write fails, blank-input rejection and service-only grants. This is a control-flow
and transaction check, not an end-to-end production encryption or Push delivery
test. The connected project has DELETE access on `vault.secrets` and no foreign
keys referencing it. It has no stored VAPID pair and retains 213 pending Push rows.

The Supabase connector's migration confirmation expired on both apply attempts;
readback confirmed that no migration entry or changed setter was installed there.
The new SQL remains pending for database deployment. No production database was
modified. No lint, health probe or live notification was run. Temporary validation
tooling was removed.
