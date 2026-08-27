create index if not exists conference_role_assignments_role_idx
  on private.conference_role_assignments(role);

create index if not exists conference_role_permissions_permission_idx
  on private.conference_role_permissions(permission);
