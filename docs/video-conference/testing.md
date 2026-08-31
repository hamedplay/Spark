# Spark Video Conference — Testing

## 1. Test strategy

Conference testing is split into five layers:

1. contract tests
2. unit/behavior tests
3. runtime integration tests
4. browser E2E tests
5. LiveKit load tests

Build validation is also mandatory for code changes.

Per project workflow, **Lint is not used as the validation gate** for this conference implementation.

## 2. Core commands

### Contract tests

```bash
npm run test:video-conference:contract
```

Runs:

```text
tests/video-conference/phase*.test.mjs
```

These tests validate architecture contracts, migrations, security boundaries, deployment assets, and phase-specific invariants.

### Unit/behavior tests

```bash
npm run test:video-conference:unit
```

Primary behavior suite:

```text
tests/video-conference/phase24UnitBehavior.test.ts
```

### Combined local suite

```bash
npm run test:video-conference
```

### Build

```bash
npm run build
```

The build runs TypeScript compilation and Vite production build.

## 3. Runtime integration

Command:

```bash
npm run test:video-conference:integration
```

Runner:

```text
tests/video-conference/runtime/phase24IntegrationRuntime.mjs
```

This suite requires real environment credentials/configuration.

It is designed to validate authoritative runtime behavior instead of only checking source text.

Without required credentials, the runner is expected to **fail closed** rather than silently pass.

## 4. Browser E2E

Command:

```bash
npm run test:video-conference:e2e
```

Runner:

```text
tests/video-conference/e2e/phase24ConferenceE2E.mjs
```

The E2E suite uses two authenticated browser contexts and covers flows such as:

- two users joining the same room
- public chat propagation
- private chat
- raise hand / speaker queue
- host mute and media restriction
- timed speaker session
- screen share
- poll create/vote
- phase countdown
- break/resume
- optional recording start/stop
- browser network loss and recovery

The runner requires prepared authentication storage states and a dedicated conference environment.

## 5. Load testing

Command:

```bash
npm run test:video-conference:load
```

Runner:

```text
tests/video-conference/load/run-phase24-livekit-load.sh
```

Safety rule:

```text
test room name must begin with phase24-load-
```

The harness downloads a pinned LiveKit CLI release, verifies its checksum, and uses `lk perf load-test`.

Planned default profile:

- 20 total simulated participants
- 10 video publishers
- 10 audio publishers
- 10 subscribers
- simulated speakers
- configurable duration/join rate
- packet-loss threshold default 5%
- zero subscriber errors required

## 6. Load dry-run

Set:

```bash
PHASE24_LOAD_DRY_RUN=1 npm run test:video-conference:load
```

Dry-run verifies the pinned LiveKit CLI and required load-test flags without connecting to the production LiveKit server.

A successful dry-run proves test tooling compatibility, **not** real 20-user production capacity.

## 7. Documentation contract

Phase 26 adds:

```text
tests/video-conference/phase26Documentation.test.mjs
```

It verifies that the required operational documentation exists and preserves key architecture/security facts.

## 8. Test environment separation

Never point destructive or load-oriented tests at an arbitrary user room.

Use:

- dedicated test room IDs/names
- dedicated test accounts
- explicit environment variables
- test-only storage/auth state where applicable

Avoid logging Bearer tokens, LiveKit secrets, service-role keys, TURN credentials, or storage credentials.

## 9. Acceptance guidance

For a normal source change:

- relevant phase/contract test passes
- unit behavior suite passes if logic changed
- `npm run build` passes

For server-authoritative DB/Edge changes:

- relevant RPC/query validation passes against the target DB
- conference suite passes
- build passes

For deployment/media changes:

- config validation
- conference suite
- runtime integration
- E2E where applicable
- live load test on the target host/network before increasing production capacity

## 10. Current 20-participant status

The repository has the test harness required to exercise a 20-participant load profile.

The current live database configuration is `max_participants=10`.

Do not document 20-user production readiness as proven until the real live load run passes on the intended production topology with acceptable metrics.
