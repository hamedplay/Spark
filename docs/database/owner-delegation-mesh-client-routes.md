# Owner delegation and Mesh role client routes

Migration: `20261028054407_restore_owner_delegation_and_mesh_role_client_routes.sql`.

## Root causes and minimal changes

The public owner-delegation wrappers are SECURITY INVOKER, but their private
implementations had EXECUTE only for postgres. Actual FULL authenticated users
received 42501 before either implementation could run. The migration grants
authenticated EXECUTE on exactly:

- private.assign_meeting_owner_delegate(uuid,uuid)
- private.get_my_meeting_owner_delegations_v1()

Both implementations already enforce FULL session access and meeting ownership.
Their bodies, organization rules, pending-request rules and notification behavior
are unchanged. Anonymous EXECUTE remains denied.

The legacy Mesh UI calls public.set_conference_participant_role directly, while its
private role implementation is intentionally service-only. Granting browser access
to that low-level implementation would also expose the SFU role path without its
service/LiveKit coordination.

The public wrapper remains SECURITY INVOKER and now calls a narrow private
set_mesh_conference_participant_role gateway. That gateway is owner-executed because
it mediates the protected role write; it explicitly validates the authenticated,
non-anonymous actor, canonical FULL session and MANAGE_ROLES permission before
accessing the room. It locks the active room row and permits only media_topology=mesh,
then calls the existing role implementation. Existing actor/target rank, self/owner,
participant and role validation remains in that implementation.

Authenticated SFU requests return ok:false/reason:use_sfu_host_control. The existing
low-level role implementation and SFU apply function remain unavailable to browsers
and available to service_role. The SFU service apply endpoint/body is unchanged.
No public wrapper was converted to SECURITY DEFINER. No tables, columns, frontend
files, previous migrations or unrelated RPC grants changed.

This new migration records both grants and the guarded gateway for database moves;
apply it through the normal migration runner after restoring the source schema.

## Validation

Executed tests/database/ownerDelegationAndMeshRoleRoutes.sql through the connected
non-production database with plpgsql.check_asserts enabled. All fixtures, meetings,
inbox rows, notifications, rooms, role/audit changes and temporary settings roll back.

- Actual authenticated owner can assign a same-organization delegate and read only
  their own pending delegation; the inbox and template notification persist in the
  transaction. Non-owner and cross-organization requests are denied.
- Actual authenticated Mesh owner can promote a participant to MODERATOR; the
  participant role and audit row are verified.
- A regular participant cannot manage roles; a moderator cannot promote above their
  rank; assigning OWNER and changing the room owner remain denied.
- Browser SFU mutation is rejected without changing its participant role. Direct
  browser calls to the service implementations remain denied by ACL.
- The actual service_role SFU apply RPC still updates its fixture participant role.
  This validates the database boundary, not external LiveKit/media synchronization.
- Seven blocked/restricted states deny owner assignment, owner-list reads and Mesh
  role writes: revocation, temporary lock, suspension, idle expiry, absolute expiry,
  epoch mismatch and MFA restriction. Role, notification and audit effects stay unchanged.
- Anonymous calls remain denied. Final checks confirm private low-level role RPCs
  are still service-only and the public wrapper remains invoker.
- Updated the notification SQL regression to call owner delegation as authenticated;
  its earlier owner-only fallback and historical limitation note are superseded.

Run as the migration owner on a migrated non-production database:

```sh
psql -X -v ON_ERROR_STOP=1 -f tests/database/ownerDelegationAndMeshRoleRoutes.sql
```

## Existing code-test limitation

The combined code-test run passed 17 notification producer/model tests, but the old
meetingDelegation suite failed 20 cases because it searches for a historical
fix_assign_meeting_invitation_delegate migration absent from the starting main tree.
phase2Rbac.test.mjs also failed to load because its referenced
20260827195314_video_conference_phase2_rbac.sql is absent. Neither those tests nor
their frontend source files were changed. git ls-tree/cat-file confirmed the missing
migration references predate this work. These two existing suites were left unchanged
to respect scope; no claim is made that all repository tests pass.

The updated notification/session suite, role/phone/sharing suite and admin/avatar/informee
suite all passed after this migration, in addition to the new client-route SQL suite.
The production build passed. Final checks confirmed owner EXECUTE grants, preserved
low-level service-only ACLs, zero fixture rows and restoration of the video-enabled
setting. No lint or PR was run/created.
