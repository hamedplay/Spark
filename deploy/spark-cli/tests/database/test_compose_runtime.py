from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from config.models import DatabaseConfig, EnvironmentConfig, NodeConfig, SupabasePackageConfig
from roles.database.runtime.compose import DatabaseComposeManager
from secrets.file_provider import FileSecretProvider
from secrets.models import REQUIRED_DATABASE_SECRETS


class FakeDocker:
    def compose_config(self, project_dir, env_file, project_name="spark-supabase"):
        return "services:\n  db: {}\n"
    def compose_services(self, project_dir, env_file, project_name="spark-supabase"):
        return ("db", "auth", "rest", "realtime", "storage", "api-gw", "studio", "supavisor")


UPSTREAM_COMPOSE = """name: supabase
services:
  db:
    image: postgres:17
    volumes:
      - ./volumes/db/init.sql:/docker-entrypoint-initdb.d/init.sql:ro
      - ./volumes/db/data:/var/lib/postgresql/data
  auth:
    image: auth:test
    depends_on:
      db:
        condition: service_started
  rest:
    image: rest:test
  realtime:
    image: realtime:test
  storage:
    image: storage:test
    volumes:
      - ./volumes/storage:/var/lib/storage
  api-gw:
    image: envoy:test
  studio:
    image: studio:test
    volumes:
      - ./volumes/functions:/app/edge-functions:ro
  supavisor:
    image: pooler:test
  functions:
    image: supabase/edge-runtime:test
    depends_on:
      db:
        condition: service_started
"""


class ComposeRuntimeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        base = Path(self.tmp.name)
        self.root = base / "supabase"
        vendor = self.root / "vendor" / "upstream"
        (vendor / "volumes" / "db" / "data").mkdir(parents=True)
        (vendor / "volumes" / "db" / "init.sql").write_text("select 1;\n")
        (vendor / "volumes" / "db" / "data" / "vendor-placeholder").write_text("must-not-copy\n")
        (vendor / "volumes" / "storage").mkdir(parents=True)
        (vendor / "volumes" / "storage" / "vendor-placeholder").write_text("must-not-copy\n")
        (vendor / "volumes" / "functions").mkdir(parents=True)
        (vendor / "docker-compose.yml").write_text(UPSTREAM_COMPOSE)
        (vendor / ".env.example").write_text("POSTGRES_PORT=5432\nPOSTGRES_DB=postgres\n")
        (self.root / ".env.example").write_text("POSTGRES_PORT=5432\nPOSTGRES_DB=postgres\n")
        self.secret_file = base / "secrets" / "database.env"
        self.secrets = FileSecretProvider(self.secret_file)
        for key in REQUIRED_DATABASE_SECRETS:
            self.secrets.set(key, f"value-{key}")
        self.profile = EnvironmentConfig(
            name="test",
            nodes={
                "database": NodeConfig(role="database", host="10.0.0.3"),
                "application": NodeConfig(role="application", host="10.0.0.2"),
                "reverse_proxy": NodeConfig(role="reverse_proxy", host="10.0.0.1"),
            },
            database=DatabaseConfig(
                supabase=SupabasePackageConfig(destination=str(self.root)),
                secret_file=str(self.secret_file),
            ),
        )

    def test_materialization_is_idempotent_private_and_excludes_edge(self):
        manager = DatabaseComposeManager(FakeDocker())
        self.assertTrue(manager.materialize(self.profile, self.secrets))
        self.assertFalse(manager.materialize(self.profile, self.secrets))
        self.assertEqual((self.root / ".env").stat().st_mode & 0o777, 0o600)
        compose = (self.root / "docker-compose.yml").read_text()
        self.assertNotIn("  functions:", compose)
        self.assertNotIn("./volumes/functions", compose)
        self.assertIn("    ulimits:\n      nofile:\n        soft: 100000\n        hard: 100000", compose)
        self.assertTrue((self.root / "volumes" / "db" / "init.sql").exists())

    def test_runtime_data_directories_do_not_receive_vendor_assets(self):
        manager = DatabaseComposeManager(FakeDocker())
        manager.materialize(self.profile, self.secrets)
        postgres_data = self.root / "volumes" / "db" / "data"
        storage_data = self.root / "volumes" / "storage"
        self.assertTrue(postgres_data.is_dir())
        self.assertTrue(storage_data.is_dir())
        self.assertEqual(list(postgres_data.iterdir()), [])
        self.assertEqual(list(storage_data.iterdir()), [])

    def test_verify_checks_required_capabilities(self):
        manager = DatabaseComposeManager(FakeDocker())
        manager.materialize(self.profile, self.secrets)
        result = manager.verify(self.profile)
        self.assertTrue(result["valid"])
        self.assertFalse(result["edge_functions"])

    def test_runtime_metadata_contains_no_secret_values(self):
        manager = DatabaseComposeManager(FakeDocker())
        manager.materialize(self.profile, self.secrets)
        metadata = (self.root / "runtime" / "metadata.json").read_text()
        for key in REQUIRED_DATABASE_SECRETS:
            self.assertNotIn(f"value-{key}", metadata)
        self.assertEqual(json.loads(metadata)["edge_functions"], False)


if __name__ == "__main__":
    unittest.main()
