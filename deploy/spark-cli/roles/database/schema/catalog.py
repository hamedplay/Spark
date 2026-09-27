from __future__ import annotations

import json
import re
from pathlib import Path

from adapters import DockerAdapter
from config.models import EnvironmentConfig


_MUTATING_SQL = re.compile(
    r"\b(?:CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|TRUNCATE|GRANT|REVOKE|COPY|CALL|DO|VACUUM|ANALYZE|REFRESH|REINDEX|CLUSTER)\b",
    re.IGNORECASE,
)


def assert_read_only_query(sql: str) -> None:
    normalized = " ".join(sql.strip().split())
    if not normalized:
        raise ValueError("catalog query must not be empty")
    if not re.match(r"^(SELECT|WITH)\b", normalized, re.IGNORECASE):
        raise ValueError("catalog query must start with SELECT or WITH")
    if _MUTATING_SQL.search(normalized):
        raise ValueError("mutating SQL is forbidden in live schema inventory")


class ReadOnlyCatalog:
    """Execute Spark schema catalog queries inside a DB-enforced READ ONLY transaction."""

    service_name = "db"

    def __init__(self, docker: DockerAdapter | None = None) -> None:
        self.docker = docker or DockerAdapter()

    def query(self, profile: EnvironmentConfig, sql: str, *, timeout: int = 120) -> list[dict]:
        assert_read_only_query(sql)
        root = Path(profile.database.supabase.destination)
        env_file = root / ".env"
        wrapped = (
            "BEGIN READ ONLY; "
            "SET LOCAL statement_timeout = '110s'; "
            "SELECT COALESCE(jsonb_agg(to_jsonb(_spark_inventory_row)), '[]'::jsonb)::text "
            f"FROM ({sql.rstrip().rstrip(';')}) AS _spark_inventory_row; "
            "ROLLBACK;"
        )
        command = (
            "sh", "-lc",
            "PGPASSWORD=\"$POSTGRES_PASSWORD\" exec psql -X -qAt -v ON_ERROR_STOP=1 "
            "-h 127.0.0.1 -U postgres -d \"${POSTGRES_DB:-postgres}\" -c \"$1\"",
            "spark-schema-inventory",
            wrapped,
        )
        result = self.docker.compose_exec(
            root,
            env_file,
            self.service_name,
            command,
            project_name=profile.database.compose.project_name,
            timeout=timeout,
        )
        if result.returncode != 0:
            raise RuntimeError("read-only PostgreSQL catalog query failed")
        candidates = [line.strip() for line in result.stdout.splitlines() if line.strip().startswith("[")]
        if len(candidates) != 1:
            raise RuntimeError("read-only catalog query returned an unexpected payload")
        try:
            payload = json.loads(candidates[0])
        except json.JSONDecodeError as exc:
            raise RuntimeError("read-only catalog query returned invalid JSON") from exc
        if not isinstance(payload, list) or any(not isinstance(item, dict) for item in payload):
            raise RuntimeError("read-only catalog result must be a JSON array of objects")
        return payload
