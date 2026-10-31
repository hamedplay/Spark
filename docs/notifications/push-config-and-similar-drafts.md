# Push configuration and similar meeting drafts

The supplied production trace contains two different requests: an unauthenticated
GET navigation returning `AUTH_ACCESS_RESTRICTED`, and an application POST returning
500. A navigation without Authorization is not a valid authenticated Push test.
The production POST response body/server log was not supplied, so its exact cause
cannot be established from that trace. The connected database is a separate test
environment. Its worker logs show a service-role request failing with PGRST303
(`JWT issued at future`). This does not prove the production error has that cause.

Normal public VAPID key reads now use `get_my_pwa_push_config` in the caller's own
session, without a service-role HTTP hop. The private implementation verifies FULL
access and returns only `publicKey` when configured. Missing/unreadable keys now
return `configured: false`; the browser uses the authenticated server initializer
to repair them. See [the console repair](console-realtime-and-push-repair.md).
The existing service-only private-key APIs remain inaccessible to authenticated
users. The Edge endpoint uses the same reader and retains first-install provisioning;
it returns 401 for a missing bearer token rather than disguising it as restricted access.
Existing VAPID keys are not rotated by this migration.

Similar meeting creation now passes an explicit create mode. Edit identity and bulk
targets are derived synchronously from props rather than copied into mutable state
by an effect. Create mode ignores any residual source ID. Late edit reads are ignored
after identity changes. Existing create dispatch uses only final selected recipients.
The supplied cancellation was not reproduced against the production database; its
exact producer and deployed frontend version still require production evidence.

Validation of the earlier change: 16 focused Node tests and the production build pass. The new SQL test
checks a real FULL session, expired-session rejection, public-only output and grants
inside a rolled-back transaction. Migration and Edge version 2 were applied only to
the connected test project. No real SMS or browser Push delivery is claimed.

Production rollout requires applying the new migration, publishing the frontend and
deploying the updated Edge function. Confirm that both VAPID keys already exist.
The supplied trace also reports `realtime.subscription.subscription_id` missing;
that indicates a Realtime service/schema compatibility problem in that environment.
That earlier change did not alter Supabase's internal Realtime schema. The current
console repair provides a separate guarded migration for the reported old table.
