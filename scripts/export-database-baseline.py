#!/usr/bin/env python3
"""Export a schema baseline and migration identities using normal libpq settings.

Run on the database host with matching pg_dump/psql versions. Authentication is
read from libpq environment/service/password files; no credentials are logged.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path


HISTORY_SQL = """
SELECT format(
  'INSERT INTO supabase_migrations.schema_migrations(version,name) VALUES (%L,%L) ON CONFLICT (version) DO NOTHING;',
  version,name)
FROM supabase_migrations.schema_migrations ORDER BY version
""".strip()


def export_baseline(destination: Path) -> None:
    destination = destination.resolve()
    if destination.exists():
        raise FileExistsError("Choose a new output directory; existing baselines are never overwritten")
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="spark-schema-", dir=destination.parent) as tmp:
        root = Path(tmp)
        # Keep ACLs, owners, schemas, triggers and policies, including custom hooks
        # on auth/storage. No application rows or Vault secret values are exported.
        subprocess.run(["pg_dump", "--schema-only", "--file", str(root / "schema.sql")], check=True)
        history = subprocess.run(
            ["psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-c", HISTORY_SQL],
            text=True, capture_output=True, check=True,
        )
        (root / "migration-history.sql").write_text(history.stdout, encoding="utf-8")
        version = subprocess.run(
            ["psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-c", "SHOW server_version"],
            text=True, capture_output=True, check=True,
        )
        manifest = {
            "created_at": datetime.now(timezone.utc).isoformat(),
            "server_version": version.stdout.strip(),
            "application_data_included": False,
            "privileges_included": True,
            "files": {
                name: hashlib.sha256((root / name).read_bytes()).hexdigest()
                for name in ("schema.sql", "migration-history.sql")
            },
        }
        (root / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
        # The work directory is removed on any failure; publish only complete output.
        root.rename(destination)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("destination", type=Path)
    args = parser.parse_args()
    try:
        export_baseline(args.destination)
    except (OSError, subprocess.CalledProcessError):
        parser.exit(1, "Baseline export failed; verify libpq settings and PostgreSQL tool versions.\n")
    print(f"Schema baseline exported to {args.destination}")


if __name__ == "__main__":
    main()
