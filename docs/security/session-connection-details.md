# IP evidence and session details

Scope: Configuration → Users → Events and Profile → Session management.

## Verified findings

- `SessionManagementPanel` received no IP fields, rendered a truncated raw User-Agent and called every valid token/session “active”; this did not establish online presence.
- Password/phone/registration gateways create Auth sessions via internal service calls. The browser's first X-Forwarded-For element is not a reliable client address and internal Auth IPs must not be substituted for a user's connection.
- The connected copy has 558 session registry rows and no retained first-FULL context rows. It cannot reproduce a particular current production device or recover missing historical IPs.
- `security_audit_events_ip_address_null` deliberately prohibits raw IP storage in the security audit table. That constraint remains in place.

## Minimal repair

Nginx overwrites both `X-Spark-Client-IP` and `X-Spark-Client-IP-Source: nginx-v2`. Existing exact trusted-proxy CIDRs are preserved; client-supplied XFF and IP headers are never accepted as evidence. The version marker is a deployment contract, not a signature: gateway access must remain restricted to the trusted ingress. Never expose PostgREST/Functions directly with these headers trusted. If another proxy precedes Nginx, configure only its verified IP/CIDR; a database cannot infer the correct topology.

The three verified login gateways record the bounded ingress header subset against the exact newly authorized Auth/session-registry pair. A service-only RPC records immutable initial IP and its observation phase in an RLS-enabled private table. No credentials, body, cookies or arbitrary headers are stored. Failure of evidence recording never authorizes or rejects a login.

After FULL access, a JWT-bound RPC records the browser's optional allowlisted device hints. Existing heartbeat authorization and timeout policy are preserved. The heartbeat forwards only canonical ingress evidence across its internal HTTP hop and updates latest IP/last connection time; it cannot overwrite initial IP. Browser hints are descriptive, never authorization inputs. A first-FULL observation is labelled separately from a gateway-login observation, rather than claiming to be an exact historical login IP.

The event feed presents a `session.login_connection` record with network evidence joined by exact user/session identity. The security table stores no raw IP. Identity-service authentication and FULL application access remain distinct stages. Historical/internal addresses are preserved as `reported_ip_address` but are not presented as verified user IPs. There is no nearest-timestamp or latest-user-session matching. Historical device evidence is not reinterpreted using current session hints.

Session management displays initial/latest IP, OS/browser versions where disclosed, Android model where disclosed, current device, server-clock-adjusted elapsed times and Tehran timestamps. Windows hints distinguish Windows 10/11; reduced UA without hints stays ambiguous. Apple privacy restrictions remain explicit. Presence means a connection within the configured heartbeat interval plus 60 seconds; an offline session can still be valid. Offline duration is approximate. Explicit revoke/Auth-session deletion times are retained separately from last contact; unknown historical logout time stays unknown. Auth-session deletion is observed by a private AFTER DELETE trigger, without changing sign-out scope or Auth behavior. Connection rows cascade only when the existing session registry is cleaned.

## Deployment

Both new migrations are required, in order:

1. `20261104090809_session_connection_evidence.sql`
2. `20261104093610_preserve_security_event_ip_privacy.sql`

Both are applied on the connected copy. The second preserves the security table's no-raw-IP constraint in the new writer. Neither earlier migration nor existing evidence is rewritten.

Deploy the matching frontend, `_shared/sessionConnection.ts`, `password-login`, `verify-phone-login-otp-v2`, `verify-public-registration-otp` and `session-management` through the existing Spark deployment. The copy has no deployed instances of these four endpoints; they were not created with guessed runtime configuration.

On the actual database host, from the updated checkout:

```sh
bash deploy/spark-cli/apply-session-connection-db.sh --check supabase-db
bash deploy/spark-cli/apply-session-connection-db.sh --apply supabase-db
bash deploy/spark-cli/apply-session-connection-db.sh --check supabase-db
```

On the actual application ingress host:

```sh
bash deploy/spark-cli/apply-event-client-headers.sh --check
bash deploy/spark-cli/apply-event-client-headers.sh --apply
```

For a verified preceding reverse proxy, pass its exact `--trusted-proxy CIDR` to the header helper instead of trusting arbitrary header chains. The helper backs up the current file, validates Nginx, reloads and rolls back on failure. This upgrade does not guess an external proxy address or change the site's routing/TLS.

Validate with a new login through the real ingress and compare its known network egress address with “IP هنگام ورود”; then change networks and confirm only “آخرین IP اتصال” changes. Behind NAT/VPN this is the address observed by the service, not a private Wi-Fi interface address. New historical facts cannot be recovered from hashes.

## Validation

- Focused audit/session tests and header helper tests; build and shell syntax checks. No lint.
- `tests/database/sessionConnectionEvidence.sql` covers provenance, IPv6, immutable initial IP, changing latest IP, hint redaction, presence, ownership, grants, Auth deletion observation and registry retention cascade. Full suite runs in isolated PGlite with the real no-raw-IP check constraint; the connected copy ran the non-delete subset in a rolled-back transaction.
- Actual event-center SQL projection is exercised locally: correct login-session IP, internal Auth IP preserved as unverified, unchanged security IP privacy constraint, FULL-session capture.
- Real component/browser fixtures exercise 390px/mobile and desktop, versions, IP fields, history, elapsed time, current-session badge and correct revoke target. Fixtures are not live production evidence.

References: [Nginx real IP](https://nginx.org/en/docs/http/ngx_http_realip_module.html), [Windows version hints](https://learn.microsoft.com/en-us/microsoft-edge/web-platform/how-to-detect-win11), [Chrome Client Hints](https://developer.chrome.com/docs/privacy-security/user-agent-client-hints).

## Follow-up: missing login/activity IP and online users

A real rolled-back integration test found the exact FULL-context failure: the pre-existing `event_session_context_ip_source_check` allowed only `proxy_header` and `forwarded_header`, while the newer writer inserted `trusted_ingress`. PostgreSQL rejected the whole statement (23514). The evidence writer's best-effort behavior hid that failure from the interface. New migration `20261104102551_allow_verified_ingress_session_ip_source.sql` extends this allowlist without rewriting historical records. The regression suite now includes the original constraint, rather than an unconstrained approximation.

New migration `20261104102315_online_session_presence_and_ingress_recovery.sql` also fixes two persistence defects: an internal request without canonical IP no longer erases the last verified IP, and a missing initial gateway IP can be completed by an immediate, JWT-bound browser login observation. This records the observation time/phase, accepts no caller IP/user/session parameters and only runs for an Auth session created within two minutes. It does not grant application/MFA access. All three gateway login forms capture through the same browser REST ingress that successfully records logout.

The existing minute-level browser `user_presence` write now captures verified per-session connection evidence through a private trigger after FULL authorization. A missing/broken internal Functions route is therefore not required to learn the browser's current IP. IP observation time is separate from last connection time; the online panel displays an IP only when that exact session's verified observation is recent. Unknown IPs stay unknown. A false recorder result is no longer cached as success.

Page transitions now produce distinct browser-reported `page_view` audit entries, using the page title and server-derived identity/IP; previously no navigation producer existed. URL query/fragment values are excluded from these audit requests. Native Auth logs that lack verified IP remain unmodified, and are never matched to another event by nearest time or a user's latest session.

Configuration → Users → Online users now groups exact sessions per user, shows device/IP/last connection, supports server-side name/IP/device search, refresh pause/resume and copying IP. The read RPC requires the existing FULL-session online-users permission. Individual or all-user revocation preserves the existing security-admin and recent TOTP step-up requirements, refuses self-revocation through this panel, records actor/target/count/reason, and does not delete Auth identities or history. Effective access is revoked immediately; an already-open client leaves via its existing session validation/heartbeat cadence. This is not a claim of immediate remote tab closure.

Profile history now opens in a native dialog with a bounded independently scrollable list, closes on Escape and keeps the main page height unchanged. Active sessions remain on the main profile. Refresh/history actions have distinct spacing. Event details actions are non-shrinking and non-wrapping, and the desktop event table has enough minimum width to keep “جزئیات” intact.

Deploy the frontend and use the updated scoped DB helper:

```sh
bash deploy/spark-cli/apply-session-connection-db.sh --check supabase-db
bash deploy/spark-cli/apply-session-connection-db.sh --apply supabase-db
```

It applies only the two new follow-ups atomically and records only actual executions. The previously installed session-connection objects are checked in the database; the old migration files removed concurrently from main are not restored or required by this helper. Existing migrations are unchanged. The new browser capture/presence and online-user paths use REST RPCs and do not require a new Edge Function deployment. Existing canonical Nginx ingress configuration is still required.

Validation includes a real copy-database regression (failure reproduced, new constraint applied, successful rerun with all fixtures rolled back), isolated SQL with original privacy/source constraints, missing-IP recovery, changing-network IP, no internal overwrite, exact-session event projection, search, permission/TOTP denial, self-protection and audited revocation. Browser fixtures check grouped devices, IP search, correct revoke target after step-up, mobile overflow, bounded history scrolling with unchanged document height, Escape, and desktop event-button layout. No real user was kicked during validation.
