# Targeted compatibility overrides loaded after the core install modules.

repair_supabase_bootstrap() {
  local has_internal_db
  has_internal_db="$(cd "$SUPABASE_ROOT" && docker compose exec -T db psql -U postgres -d postgres -Atqc "select 1 from pg_database where datname='_supabase'" 2>/dev/null || true)"

  # In an interrupted/partial initialization the PostgreSQL image may have
  # created the main Supabase roles while supabase_functions_admin is still
  # absent. Supabase's official role definition is:
  # NOINHERIT CREATEROLE LOGIN NOREPLICATION.
  (cd "$SUPABASE_ROOT" && docker compose exec -T db psql \
    -v ON_ERROR_STOP=1 -U postgres -d postgres <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_functions_admin') THEN
    CREATE USER supabase_functions_admin NOINHERIT CREATEROLE LOGIN NOREPLICATION;
  END IF;
END
$$;
SQL
  ) || return 1

  # Replay the official password synchronization after all roles it references
  # are guaranteed to exist.
  (cd "$SUPABASE_ROOT" && docker compose exec -T db sh -lc \
    'psql -v ON_ERROR_STOP=1 -U postgres -d postgres -f /docker-entrypoint-initdb.d/init-scripts/99-roles.sql') || return 1

  # Repair schemas and role search_paths expected by the official self-hosted
  # services. This is intentionally idempotent and does not drop data.
  (cd "$SUPABASE_ROOT" && docker compose exec -T db psql \
    -v ON_ERROR_STOP=1 -U postgres -d postgres <<'SQL'
CREATE SCHEMA IF NOT EXISTS auth AUTHORIZATION supabase_auth_admin;
ALTER SCHEMA auth OWNER TO supabase_auth_admin;
ALTER ROLE supabase_auth_admin SET search_path = auth;
GRANT USAGE, CREATE ON SCHEMA auth TO supabase_auth_admin;

CREATE SCHEMA IF NOT EXISTS storage AUTHORIZATION supabase_storage_admin;
ALTER SCHEMA storage OWNER TO supabase_storage_admin;
ALTER ROLE supabase_storage_admin SET search_path = storage;
GRANT USAGE, CREATE ON SCHEMA storage TO supabase_storage_admin;

CREATE SCHEMA IF NOT EXISTS _realtime AUTHORIZATION supabase_admin;
ALTER SCHEMA _realtime OWNER TO supabase_admin;
GRANT USAGE, CREATE ON SCHEMA _realtime TO supabase_admin;

CREATE SCHEMA IF NOT EXISTS graphql_public AUTHORIZATION supabase_admin;
ALTER SCHEMA graphql_public OWNER TO supabase_admin;
GRANT USAGE ON SCHEMA graphql_public TO postgres, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA graphql_public TO authenticator;
ALTER DEFAULT PRIVILEGES FOR USER supabase_admin IN SCHEMA graphql_public
  GRANT ALL ON TABLES TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR USER supabase_admin IN SCHEMA graphql_public
  GRANT ALL ON FUNCTIONS TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR USER supabase_admin IN SCHEMA graphql_public
  GRANT ALL ON SEQUENCES TO postgres, anon, authenticated, service_role;

ALTER ROLE supabase_admin SET search_path = "$user", public, auth, extensions;
SQL
  ) || return 1

  # Supavisor requires the internal _supabase database. Create it only when the
  # interrupted bootstrap did not get far enough to create it.
  if [[ "$has_internal_db" != "1" ]]; then
    (cd "$SUPABASE_ROOT" && docker compose exec -T db sh -lc \
      'psql -v ON_ERROR_STOP=1 -U postgres -d postgres -f /docker-entrypoint-initdb.d/migrations/97-_supabase.sql') || return 1
  fi

  # The official pooler bootstrap is idempotent after _supabase exists.
  (cd "$SUPABASE_ROOT" && docker compose exec -T db sh -lc \
    'psql -v ON_ERROR_STOP=1 -U postgres -d postgres -f /docker-entrypoint-initdb.d/migrations/99-pooler.sql') || return 1
}

# Override the core readiness probe so an interrupted initialization cannot be
# reported as repaired while required service schemas are still absent.
supabase_bootstrap_ready() {
  (cd "$SUPABASE_ROOT" && docker compose exec -T db psql -U postgres -d postgres -Atqc \
    "select case when
      exists(select 1 from pg_database where datname='_supabase')
      and exists(select 1 from pg_roles where rolname='supabase_storage_admin')
      and exists(select 1 from pg_roles where rolname='supabase_auth_admin')
      and exists(select 1 from pg_roles where rolname='authenticator')
      and exists(select 1 from pg_roles where rolname='supabase_admin')
      and exists(select 1 from pg_namespace where nspname='auth')
      and exists(select 1 from pg_namespace where nspname='storage')
      and exists(select 1 from pg_namespace where nspname='_realtime')
      and exists(select 1 from pg_namespace where nspname='graphql_public')
      then 1 else 0 end" 2>/dev/null | grep -qx 1)
}
