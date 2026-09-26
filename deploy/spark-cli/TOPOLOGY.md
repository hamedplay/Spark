# Spark split-role topology

Spark Manager can be installed on every Spark server. For the approved bank topology, use these role values in `/etc/spark/manager.conf`:

```ini
SPARK_NODE_ROLE=database
SPARK_DB_HOST=10.211.96.194
SPARK_DB_PORT=5432
SPARK_APP_HOST=10.211.19.74
```

on the database server, and:

```ini
SPARK_NODE_ROLE=application
SPARK_DB_HOST=10.211.96.194
SPARK_DB_PORT=5432
SPARK_APP_HOST=10.211.19.74
```

on the application server.

## Database node

The database node owns the PostgreSQL data volume and exposes PostgreSQL only on the configured database IP/port. Application services must not run here.

## Application node

The application node runs the Spark frontend and Supabase application services, but PostgreSQL is external. The application stack must use `SPARK_DB_HOST`/`SPARK_DB_PORT` for database connections and must not start a local database container.

## Migration

For an existing Spark installation, preserve the current Supabase secrets (`POSTGRES_PASSWORD`, `JWT_SECRET`, `ANON_KEY`, `SERVICE_ROLE_KEY`, and the other runtime secrets) and restore the existing database before enabling application traffic.
