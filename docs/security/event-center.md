# User event investigation center

Scope: Configuration → Users → Events (`GroupEventsPanel`). The duplicate legacy audit page and its navigation group are removed.
Existing legacy read grants continue to open this single center; unrelated
application workflows are unchanged.

## Findings and design

The previous panel silently read only 500 `audit_log` rows, hid read errors, searched
only downloaded rows, omitted `security_audit_events`, and offered bulk evidence
deletion. Security events already existed, but were not joined into this workflow.
Both audit tables had broad SQL grants even though RLS restricted row operations.
The fix revokes browser evidence-mutation privileges and preserves server writers,
existing session gates, and existing retention jobs.

The investigation design follows these primary references:

- [OWASP Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html): log authorization failures and sensitive changes; avoid secrets; distinguish suspicion from confirmed compromise.
- [GitHub audit log](https://docs.github.com/en/organizations/keeping-your-organization-secure/managing-security-settings-for-your-organization/reviewing-the-audit-log-for-your-organization): identify actor, action, time, affected resource; filter and export records.
- [Elastic Timeline](https://www.elastic.co/docs/solutions/security/investigate/timeline): investigate event details and correlate related records.
- [Supabase PGAudit](https://supabase.com/docs/guides/database/extensions/pgaudit): database statement auditing is a separate log source; avoid global/parameter logging that leaks secrets or generates excessive volume.

## Architecture

| Producer / reader | Responsibility and trust |
| --- | --- |
| Existing `write_audit_log` RPC | Browser-reported activity. Actor derived on server, but action/details remain client claims. Shown separately; result is unknown. |
| Existing security event producers | Reuse existing MFA, account, recovery and settings evidence without inventing history. |
| Private database trigger | Log committed changes to allowlisted profile access fields, groups and memberships; before/after values. Secrets, contact data and full profile snapshots excluded. Runs independently of the frontend. |
| Shared Edge authorization gate | Record restricted-access denials only after Auth verifies the actor; a failed state lookup or missing/invalid token is never attributed from an unverified payload. |
| Five sensitive Edge endpoints | Log non-admin attempts on user creation/management, deletion, retirement, backup and restore; preserve all original authorization decisions. |
| Service-only denial RPC | Browser cannot choose actor or forge server evidence. Repeated actor/resource/code attempts in 30 seconds are counted with `attempt_count` / `last_seen_at`. Request UUID identifies the recorded burst, not an externally propagated trace. |
| Guarded event-center RPC | FULL session plus existing `config_users.group_events` or `config_audit.audit_log` permission. Fixed search path, private implementation, explicit function grants. Sanitizes security metadata/states; removes query/fragment from reported URLs. |
| Investigation panel | Server search and stable `(created_at,event_key)` cursor across both stores; max 100 rows per RPC, UI pages 50, max date interval 93 days. Defaults to seven calendar dates back through today in Tehran. Page counters describe loaded records only. |

The modal shows actor/target, severity, outcome, errors, request/session identifiers,
IP or existing IP hash where available, structured context and field changes.
Actor/request pivots preserve the date interval and reset other filters. Unavailable
identity/network fields remain explicitly unknown. All untrusted text is rendered
as React text; export is JSON for displayed records only, avoiding CSV formulas.
Refresh is every 30 seconds in a visible tab, paused while a modal or older pages
are being investigated. Existing audit live notifications remain available.

## Coverage limits

- Trigger records are transactional: rolled-back operations do not leave records.
- Direct REST/RLS rejections and SQL errors require gateway/Postgres logs outside
  the failing transaction. No claim of comprehensive attack detection is made.
- Anonymous HTTP scans, invalid JWT traffic and WAF blocks are not ingested here.
- Successful operations made using service credentials may have no human actor;
  trigger metadata identifies the context as `service_or_database`.
- Warning severity means review is appropriate, not that a user is an attacker.
- Evidence remains subject to existing server retention and privileged maintenance;
  this is not an immutable external archive.
- Existing arbitrary application detail strings are not rewritten into verified facts.
- Historical events cannot be reconstructed for periods before producers existed.

## Deployment

Migration: `20261101182857_security_event_center.sql`, matched to the actual connected
project migration-history version. It adds functions/index/three triggers and revokes
browser evidence-write privileges; it does not alter historical migrations or delete
logs. Applied on the connected non-production Spark copy.

Deploy the frontend plus `_shared/accessDenialAudit.ts`, the updated shared
`requireFullAuthAccess.ts`, and `admin-users`, `admin-delete-user`, `admin-retire-user`,
`backup-data`, `restore-backup` using the existing Spark update process. Self-hosted
functions importing the shared gate must receive the helper file as well.
Changing GitHub and the copy database does not deploy the production runtime.

## Validation

- `node --import tsx --test tests/audit/*.test.ts`: behavior tests for classification,
  diffs, JSON export, secret exclusion, verified actor attribution, writer failure,
  and real Edge handlers denying non-admins before mutations.
- `tests/database/eventCenter.sql`: actual connected DB transaction; checks mutation
  privileges, service-only writer, denied reads, trigger INSERT/UPDATE/DELETE evidence,
  before/after, burst counts, filtering, cursor pagination, redaction and input bounds.
  A temporary permission stub tests authorized pagination mechanics independently of
  FULL-session evaluation; every fixture and stub rolls back.
- Standard `npm run build` succeeds. Its root tsc command checks the empty root
  project; explicit `tsc -p tsconfig.app.json --noEmit` reveals 734 existing errors
  both before and after this change, with none added by the changed UI/model.
- Legacy Phase 5 edge-gate/session-issuer suites: 78 pass / 18 fail on both the exact
  base commit and changed tree. No unrelated repairs included.
- Actual panel rendered in a temporary fixture harness using the real application
  styles. Desktop, 390px mobile and dark mode inspected. Browser checks passed for
  dialog/Escape, safe untrusted text, server-search arguments, errors/retry, JSON
  download, cursor requests and no mobile document overflow. No production login
  or live user session was simulated as a successful end-to-end deployment.
- No lint command is part of validation.

## Deployed frontend reports RPC 404 / PGRST202

The Internet application updater deliberately does not run database migrations.
The connected copy having the RPC does not prove the self-hosted website has it.
PGRST202 can mean either missing schema or a stale PostgREST schema cache.
Inspect and apply only this feature on the database host from an updated checkout:

```sh
sudo bash /opt/spark/deploy/spark-cli/apply-event-center-db.sh --check
sudo bash /opt/spark/deploy/spark-cli/apply-event-center-db.sh --apply
```

Supply the running Supabase DB container as the final argument if detection is
ambiguous. `--check` reads history/catalog only. `--apply` takes a transaction lock,
applies the unchanged canonical migration only when unrecorded and the RPC is
absent, records its version atomically and requests a PostgREST schema reload.
When already installed it only verifies dependencies and reloads the cache.
Inconsistent schema/history fails closed; no blind trigger recreation or history
repair. No unrelated migration, runtime or credential is changed.

Automatic refresh pauses after a PGRST202 response; manual retry remains available
and a successful request resumes refresh. Other network/access errors retain their
existing handling. HTTP 404 alone does not establish the exact underlying cause;
inspect the response JSON and this script's check output. A production fix is not
verified until an authenticated request to that site's RPC succeeds.
