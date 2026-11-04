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
- [Supabase Auth Audit Logs](https://supabase.com/docs/guides/auth/audit-logs): retained identity-service events live in `auth.audit_log_entries`.
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
  project; explicit `tsc -p tsconfig.app.json --noEmit` reports 733 pre-existing errors
  on both the exact base commit and the Auth-source update, with identical normalized
  diagnostics and none added by the changed UI/model/presentation modules.
- Legacy Phase 5 edge-gate/session-issuer suites: 78 pass / 18 fail on both the exact
  base commit and changed tree. No unrelated repairs included.
- Actual panel rendered in a temporary fixture harness using the real application
  styles. Desktop, 390px mobile and dark mode inspected. Browser checks passed for
  dialog/Escape, safe untrusted text, server-search arguments, errors/retry, JSON
  download, cursor requests and no mobile document overflow. No production login
  or live user session was simulated as a successful end-to-end deployment.
- No lint command is part of validation.

## Authentication source and Persian investigation details

Root cause confirmed against the uploaded export and actual database schema:
`logout` was browser-reported into `audit_log`. Auth itself already writes `login`
records into `auth.audit_log_entries`; the center read neither that source nor its
history. The connected copy has actual retained Auth login rows. Missing retained
records in another environment cannot be reconstructed or assumed to exist.

New migration `20261102042055_event_center_authentication_logs.sql` extends only
`private.get_event_center_v1`. The public RPC signature, caller/session/permission
checks, original row fields and cross-source cursor remain unchanged. Auth rows
have unique `authentication:<id>` keys, source `security`, and metadata identifying
`auth_service`. Login/logout, account and MFA audit actions are allowlisted;
routine token refresh/revocation records are intentionally excluded from this
investigation feed. Only action, known provider, verified actor UUID (when valid),
profile display name and a source/scope marker are projected. No arbitrary traits,
raw payload, account email, credentials, or additional client grants to `auth` are
exposed. Malformed/missing actor IDs preserve the event without an unsafe UUID cast.
Auth login success describes identity-service authentication, not completion of
Spark's own MFA, session or FULL-access gates. Challenge attempts have no invented
outcome. Client logout reports retain their original unknown outcome and remain
distinguishable from Auth's server records. No login producer, trigger, auth flow,
retention policy or historical audit row is rewritten.

Persian titles cover every event type in the supplied export. Categories, known
field names, enums and common descriptions are localized. JSON-encoded `details`
are parsed as data into labelled rows; names/IDs and unknown values stay intact.
A collapsible original-data inspector preserves technical evidence. JSON export
adds `*_title_fa` and `details_fa` alongside every unchanged original event field;
its `displayed_events` scope still means only the currently loaded records.

## Deployment and diagnostics

The Internet application updater deliberately does not apply database migrations.
After deploying the updated frontend, run on the real database host from the
updated Spark checkout:

```sh
sudo bash /opt/spark/deploy/spark-cli/apply-event-center-db.sh --check supabase-db
sudo bash /opt/spark/deploy/spark-cli/apply-event-center-db.sh --apply supabase-db
```

The helper now applies only this new Auth-source upgrade. It requires the existing
base RPC, supports that base even when its old migration history was not recorded,
and never fabricates historical entries or depends on the removed base migration
file. It records the new version atomically under a transaction lock, verifies the
Auth source and requests a PostgREST schema reload. It accepts an explicit DB
container and recognizes the canonical `supabase-db` name when Docker reports an
image ID. Multiple candidates fail without selecting an arbitrary database.
`--check` reports installed source/history and the retained Auth-login count for
the past seven days, without exposing user data.

PGRST202 can indicate a missing RPC or stale PostgREST schema cache. Automatic
refresh pauses after that response; manual retry remains available. A production
fix is confirmed only by an authorized request to that site's RPC. The connected
copy's successful migration is not proof of production deployment.

Additional validation:

- `tests/audit/eventCenterPresentation.test.ts`: localized sample vocabulary,
  nested JSON parsing, raw-evidence preservation, auth-stage semantics, enum values,
  unknown/prototype-looking keys and additive export labels.
- `tests/database/eventCenterAuthentication.sql`: actual rolled-back DB fixtures
  verify Auth login/logout inclusion, refresh exclusion, payload redaction, bad UUIDs,
  Persian login search, source/outcome/actor filters, shared-timestamp pagination,
  denied reads and preserved legacy permission. Temporary permission stubs test
  page mechanics; the production permission helper is restored by rollback.
- `tests/audit/eventCenterDeployment.test.mjs`: read-only diagnostics, atomic
  upgrade generation, image-ID discovery, ambiguous containers and DB failures.

The final Auth-source update passed 32 focused Node tests and both rolled-back
database suites. The actual panel was also exercised with representative sanitized
fixtures in a temporary browser harness: Persian titles/details, Auth provenance,
raw-data disclosure, safe text rendering, additive export, mobile and dark layouts.
These browser fixtures do not represent a live production login test.

## Client IP and device context

The connected copy confirmed two separate gaps: all 1,286 retained Auth login
records lacked IP/User-Agent, while 597 `session_security_state` records retained
device summaries. The event inspector did not interpret the application UA strings.
Spark's same-origin REST proxy also omitted IP forwarding; other locations appended
caller-supplied XFF. Gateway login calls do not forward the browser context to Auth.
The copy currently has no retained `auth.sessions` rows. Matching a login to a user's
latest session or nearest timestamp would invent evidence and is not used.

New migration `20261102043627_event_center_client_context.sql` adds a private,
RLS-enabled `event_session_context` table and `record_my_session_context_v1()`.
The browser makes a best-effort call after the existing bootstrap reports FULL.
The server independently rechecks the canonical FULL-session evaluator, derives
the actor and session from verified JWT claims, and accepts no caller IDs, IP or
UA parameters. It stores only a bounded request UA, a valid IPv4/IPv6 host address,
the IP source and server observation time. No cookies, authorization headers,
tokens, URLs or request bodies are copied. A session primary key deduplicates
refreshes, reloads and tabs without overwriting the first observation. A failure
does not affect login/access decisions and may retry at the next bootstrap refresh.

The new `session.first_full_access` event means the first **observed FULL request**,
including existing sessions first observed after deployment. It is separate from
Auth's original login event and timestamp. This is application instrumentation,
not comprehensive Auth/HTTP auditing; a client that never calls the writer does
not produce this additional event. The original Auth audit source remains intact.
Native Auth IP/UA are displayed when actually retained. Historical missing fields
are never backfilled. Security events can show initial context only through an
exact match on **both** session ID and actor ID; older registry device summaries
are a labelled fallback. Related-session IP/device details are separate from the
event's own fields because the request context may have changed.

The table and inspector show Persian platform/device/OS/browser descriptions,
reported versions, IP provenance and expandable raw UA. Known Edge/Opera/Samsung/
Firefox/iOS signatures take precedence over generic Chrome/WebKit. Unknown UAs,
reduced Android versions, Windows 10/11 and desktop-mode iPad/Mac ambiguity stay
explicit; hardware models are not invented. Device strings are descriptive,
client-declared evidence, not authorization inputs. These limitations follow
[MDN UA detection](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Browser_detection_using_the_user_agent)
and [MDN UA reduction](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/User-agent_reduction).

### Self-hosted upgrade

From the updated Spark checkout, configure ingress **before** publishing the new
frontend so the first session observations include the correct IP source:

```sh
sudo bash /opt/spark/deploy/spark-cli/apply-event-client-headers.sh --apply
sudo bash /opt/spark/deploy/spark-cli/apply-event-center-db.sh --apply supabase-db
sudo bash /opt/spark/deploy/spark-cli/apply-event-client-headers.sh --check
sudo bash /opt/spark/deploy/spark-cli/apply-event-center-db.sh --check supabase-db
```

Then publish the frontend with the normal Spark updater. No Edge deployment is
required for this addition. The DB helper now applies the Auth-source prerequisite
and client-context migration in order, each only when absent, in one locked
transaction. Previous migrations/history are not edited. The new migration is
already applied on the connected copy; production is a separate environment.

The header helper patches only Supabase upstream locations pointing to the existing
`127.0.0.1:8000` gateway in `/etc/nginx/sites-available/spark`. It overwrites
`X-Spark-Client-IP`, `X-Real-IP` and XFF with Nginx `$remote_addr`, retaining routing,
TLS and other upstreams. It rejects unsupported layouts before writing, saves a
backup, validates with `nginx -t`, reloads and restores on failure. Checks are
read-only and repeated applies are idempotent. The same-origin updater invokes the
same patch. Keep the gateway loopback-only, as in Spark's existing deployment.
If another proxy/CDN precedes Nginx, its allowlisted real-IP configuration must
already be correct; otherwise the observed address belongs to that proxy. A
fallback forwarded header is explicitly labelled for proxy review, not described
as a verified public address. VPN/NAT addresses do not identify a physical device.

No existing audit rows, raw-IP NULL constraint, Auth flow, permission gate or
retention job is changed. The new private context records persist independently
of Auth session deletion; existing retention jobs do not automatically clean this
new table. Access remains limited to the authorized event-center reader.

Validation includes browser/OS parsing and ambiguity cases, best-effort recorder
deduplication/retry, header overwrite/idempotence/rollback tests, and
`tests/database/eventCenterClientContext.sql` against the connected copy. Its
temporary evaluator/permission stubs isolate writer/projection mechanics and
are rolled back with every fixture. The existing event-center DB suites also
pass. Actual panel fixtures cover desktop, 390px mobile, dark mode, raw UA,
session provenance, dialog closure and absence of horizontal document overflow.

## November 4: all-history metrics, protected purge, and trusted ingress IP

New schema migration `20261104053139_event_center_global_totals_admin_clear_trusted_ip.sql` was
applied to the connected **non-production** copy. The public read RPC
`get_event_center_summary_v1()` aggregates all retained event-center source
rows (application audit, security events, allowlisted Auth audit events, and
first FULL-session observations), **without** the UI's seven-day default,
search/filter window or 50-row pagination. It returns total events, Auth login
events, attention (warning/error/critical or denied/failure/error), denied access,
and distinct verified actor IDs. These match the center's original event
classification; numbers can change after retention or new activity.

The UI includes one global-summary set, a distinct loaded-row count in the
table footer, and one labelled refresh button. The outer icon-only refresh is
hidden **only** when the Events section is active; other configuration screens
retain their existing button.

`purge_event_center_history_v1(p_confirmation)` is callable only after both
a verified FULL session and actual administrator role checks. The UI requires
typing `DELETE ALL EVENTS` and accepting a second confirmation. When
explicitly invoked, a single transaction deletes all event-center application
and security audit rows, **only the allowlisted Auth audit actions exposed in
this center**, and the private session observations. Other Auth audit actions
and unrelated security/session tables are untouched. It records a private
administrator deletion receipt with per-source deletion counts, independent
of the event feed. The migration itself **does not delete any data**.
The purge cannot be undone and is subject to organizational evidence-retention
and backup obligations. Browser grants to raw audit stores are not expanded.

The previous application audit writer used the first untrusted
`X-Forwarded-For` value; the session observer could use that as a fallback.
Both writers now accept the server-forwarded `X-Spark-Client-IP` **only**.
If the trusted ingress did not supply it, the client address is recorded as
unknown rather than misattributing a Docker gateway or spoofed header.
Previous bad/missing IP values are not rewritten.

The Nginx helper overwrites all three client-IP headers at the same-origin
Supabase upstream; it supports one or more explicit `--trusted-proxy CIDR`
options to recover the actual remote address through upstream load balancers.
The values must come from the real ingress topology (ideally exact /32 or
/128 addresses), not a guess and not a blanket trust of the Docker subnet.
Nginx's real-IP module must be available, and the trusted upstream must
correctly maintain `X-Forwarded-For`. Later normal Spark updater calls retain
the previously configured tagged trusted list. A direct peer needs no
`--trusted-proxy` option. The helper backups config, validates with
`nginx -t`, reloads Nginx and rolls back on failure.

For a self-hosted application after updating the checkout, first inspect
the effective Nginx/outer-proxy path and then run, on the correct hosts:

```sh
sudo bash /opt/spark/deploy/spark-cli/apply-event-client-headers.sh --check
# If an explicit upstream reverse proxy is verified, use its CIDR:
sudo bash /opt/spark/deploy/spark-cli/apply-event-client-headers.sh --apply --trusted-proxy <VERIFIED_PROXY_IP>/32
# Otherwise --apply without --trusted-proxy for direct clients:
# sudo bash /opt/spark/deploy/spark-cli/apply-event-client-headers.sh --apply

sudo bash /opt/spark/deploy/spark-cli/apply-event-center-global-db.sh --check supabase-db
sudo bash /opt/spark/deploy/spark-cli/apply-event-center-global-db.sh --apply supabase-db
sudo bash /opt/spark/deploy/spark-cli/apply-event-center-global-db.sh --check supabase-db
```

The separate deployment helper deliberately targets just this migration because
historical migration files may not be present in the checkout. Publish the
frontend through the normal release process. Only a **new authenticated request**
through the actual production ingress can demonstrate the true source address
received by PostgREST/Auth. Historical Auth audit entries and session-IP claims
are not retroactively changed; a copy-database test is not a production
verification.

### 2026-11-04 SQL migration parser repair

The original file `20261104053139_event_center_global_totals_admin_clear_trusted_ip.sql`
was generated from `pg_get_functiondef` and omitted all **six** final
semicolons after the function bodies. On a database where it had not been
applied, it stopped with PostgreSQL `42601` at the second `CREATE FUNCTION`
(line 42). The historical file is deliberately **unchanged**.

Use the **new, self-contained and tested** migration
`20261104060819_repair_event_center_global_migration_sql_terminators.sql`.
It contains the same event-center definitions with six missing statement
terminators added, so it works on a database where the previous SQL failed.
The script `deploy/spark-cli/apply-event-center-global-db.sh` now reads and
registers the **new version** and can be run as `--check` then `--apply`
with the explicit `supabase-db` container. No event records are deleted
by applying the migration; the purge procedure remains a separate,
admin-confirmed action. The replacement was executed on the non-production
copy and also tested under a rolled-back SQL transaction.

Do not paste or rerun the defective old file. A generic sequential migration
runner may still encounter the old, invalid file because it is intentionally
preserved in version control; use the scoped deployment helper for this
upgrade. Any later generic migration runner needs an explicit, audited
migration-history reconciliation plan; **do not fabricate old execution
history** merely to silence it. After deploying to production, verify
the replacement RPCs and required grants separately.
