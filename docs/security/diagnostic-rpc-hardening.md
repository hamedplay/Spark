# Diagnostic/callback RPCs and default-calendar creation

Apply the new migrations in the normal Spark migration directory. No Edge or
frontend change is required: existing callers already use service-role clients.

The following RPCs are server-only (`service_role` and database owner workflows):

- `bulk_classify_phone_sync`, `diagnose_phone_auth_sync_status`, `diagnose_phone_only_orphans`
- `get_auth_health_check`, `get_auth_identity_integrity_v1`, `get_admin_user_delete_blockers`
- `get_custom_mfa_readiness`, `check_phone_login_dependencies_ready`, `check_phone_login_readiness`
- `apply_livekit_webhook_event_v1`, `apply_livekit_recording_reconcile_v1`
- `ensure_default_calendars_for_user`

The migration revokes EXECUTE from PUBLIC, anon and authenticated, covering all
existing overloads, and explicitly grants service_role. An Edge Function's user,
MFA/step-up or provider-signature checks therefore cannot be bypassed by calling
the underlying public RPC directly. Browser-facing public login configuration,
user MFA state and policy APIs retain their existing grants.

`ensure_default_calendars_for_user` takes the target profile's row lock before
checking for an ordinary private calendar and a personal public calendar. It
inserts only the missing kind for active profiles. Calls for the same user are
serialized; renamed calendars remain recognizable by their flags. Additional
private calendars are allowed and existing calendars are neither deleted nor
renamed. The helper remains callable from the existing SECURITY DEFINER account
lifecycle functions; their authorization checks are unchanged.

Validate on deployment or restore:

```sh
psql -X -v ON_ERROR_STOP=1 -f tests/database/diagnosticAndCalendarSecurity.sql
psql -X -v ON_ERROR_STOP=1 -f tests/database/internalRpcExecution.sql
```

The tests roll back all fixtures and the fake provider callback event; no real
room is modified and no SMS/Push request is sent. They check denied anonymous and
browser calls, allowed server calls, duplicate prevention, user/calendar renames,
preservation of a custom calendar, inactive users and owner-executed helper chains.

Keep ACLs and migration history when transferring the database. If an import
omits or overwrites privileges, reapply the two new migration files in order and
rerun the tests. Both migrations are safe to reapply and contain no project IDs,
hostnames, credentials or generated user IDs. They do not recreate missing Edge
deployments or Vault/provider credentials.
