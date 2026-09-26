from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from roles.database.package.manager import SupabasePackageManager, SupabasePackageSpec
from roles.database.package.verifier import compose_services, verify_no_edge_functions


class FakePackageSource:
    def acquire(self, source_url: str, release: str, destination: Path) -> Path:
        docker = destination / "docker"
        (docker / "utils").mkdir(parents=True, exist_ok=True)
        (docker / "volumes" / "functions").mkdir(parents=True, exist_ok=True)
        (docker / ".env.example").write_text("POSTGRES_PASSWORD=placeholder\n")
        (docker / "run.sh").write_text("#!/bin/sh\n")
        (docker / "update.sh").write_text("#!/bin/sh\n")
        (docker / "docker-compose.yml").write_text(
            "name: supabase\n"
            "services:\n"
            "  studio:\n"
            "    image: supabase/studio:test\n"
            "    environment:\n"
            "      EDGE_FUNCTIONS_MANAGEMENT_FOLDER: /app/edge-functions\n"
            "    volumes:\n"
            "      - ./volumes/functions:/app/edge-functions:ro\n"
            "  functions:\n"
            "    container_name: supabase-edge-functions\n"
            "    image: supabase/edge-runtime:test\n"
            "  auth:\n"
            "    image: supabase/gotrue:test\n"
            "    depends_on:\n"
            "      functions:\n"
            "        condition: service_started\n"
            "      db:\n"
            "        condition: service_healthy\n"
            "  db:\n"
            "    image: supabase/postgres:test\n"
        )
        return docker


class SupabasePackageManagerTests(unittest.TestCase):
    def test_materialization_is_pinned_idempotent_and_excludes_edge(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir) / "supabase"
            spec = SupabasePackageSpec(
                release="self-hosted/v0.8.1",
                source_url="https://example.invalid/supabase.git",
                destination=root,
            )
            manager = SupabasePackageManager(FakePackageSource())
            manager.materialize(spec)
            first_metadata = (root / "spark" / "metadata.json").read_text()
            manager.materialize(spec)
            self.assertTrue(manager.detect(spec)["healthy"])
            self.assertEqual((root / ".supabase-version").read_text(), "ref=self-hosted/v0.8.1\n")
            self.assertEqual((root / "spark" / "metadata.json").read_text(), first_metadata)
            metadata = json.loads(first_metadata)
            self.assertFalse(metadata["edge_functions"])
            services = compose_services((root / "docker-compose.yml").read_text())
            self.assertNotIn("functions", services)
            self.assertIn("auth", services)
            self.assertIn("db", services)
            verify_no_edge_functions(root / "docker-compose.yml")
            self.assertTrue((root / "vendor" / "upstream" / "docker-compose.yml").exists())

    def test_mismatched_version_produces_materialize_plan(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir) / "supabase"
            root.mkdir()
            (root / ".supabase-version").write_text("ref=self-hosted/v0.7.0\n")
            spec = SupabasePackageSpec("self-hosted/v0.8.1", "https://example.invalid/repo.git", root)
            plan = SupabasePackageManager(FakePackageSource()).plan(spec)
            self.assertEqual(plan["action"], "materialize")
            self.assertEqual(plan["installed_release"], "self-hosted/v0.7.0")


if __name__ == "__main__":
    unittest.main()
