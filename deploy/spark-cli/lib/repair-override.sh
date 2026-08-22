# Targeted compatibility overrides loaded after the core install modules.

repair_supabase_bootstrap() {
  local has_internal_db
  has_internal_db="$(cd "$SUPABASE_ROOT" && docker compose exec -T db psql -U postgres -d postgres -Atqc "select 1 from pg_database where datname='_supabase'" 2>/dev/null || true)"

  # In an interrupted/partial initialization the PostgreSQL image may have
  # created the main Supabase roles while supabase_functions_admin is still
  # absent. Supabase's official post-setup defines this role as:
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
