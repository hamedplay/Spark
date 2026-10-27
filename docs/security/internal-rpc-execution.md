# Internal RPC execution and database transfers

Spark's server-side Auth, MFA, session, delivery and queue RPCs must run as
`service_role`, not directly as `anon` or `authenticated`. User-facing login,
bootstrap, MFA-state and minutes APIs keep their existing grants. Internal
minutes notification helpers remain callable by their existing SECURITY DEFINER
workflows. This change does not rewrite function bodies or application data.

The `harden_internal_rpc_execution` migration revokes EXECUTE from **PUBLIC**,
`anon` and `authenticated`, and grants it explicitly to `service_role`. Revoking
only `anon` would leave the inherited PUBLIC permission open. All existing
overloads of the reviewed names are covered. The migration has no project IDs,
hostnames, secret values or environment-specific object IDs and is safe to reapply.

## Moving an existing Spark database

1. Back up and restore the schema, function definitions, privileges and migration
   history together. Keep Spark/Supabase roles present in the destination.
2. Use the current Spark database migration runner to apply missing files from
   `supabase/migrations`. It checks each version individually: a later version in
   a restored history cannot hide an earlier missing migration.
3. Run the regression check using the destination's normal PostgreSQL connection:

   ```sh
   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f tests/database/internalRpcExecution.sql
   ```

The test rolls back, returns no secret values, and sends no SMS or Push request.
It exercises denied browser calls, allowed service calls, public login config and
an owner-executed helper chain.

If a restore used `--no-acl` / `--no-privileges`, or another import overwrote grants,
**migration history alone is not proof of security**. Reapply the exact committed
`*_harden_internal_rpc_execution.sql` file with `psql -X -v ON_ERROR_STOP=1 --single-transaction -f <file>`
and rerun the regression check. No need to recreate or repeat the investigation.
Do not copy new hosts' secrets or service-role keys into the SQL file.

The change is applied to the connected non-production database only; production
receives it when this migration is applied there. Login/provider credentials,
Vault encryption material and runtime secrets still need their normal transfer
procedure; changing RPC grants does not recreate missing credentials.

When adding a new internal RPC, explicitly revoke PUBLIC/anon/authenticated and
grant only `service_role`. This migration deliberately does not change global
default privileges for Supabase-managed schemas or block every public function.
