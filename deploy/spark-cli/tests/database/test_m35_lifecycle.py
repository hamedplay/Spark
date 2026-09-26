from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from adapters.command import CommandResult
from config.models import DatabaseConfig, EnvironmentConfig, NodeConfig, SupabasePackageConfig
from roles.database.lifecycle.images import DatabaseImageManager
from roles.database.lifecycle.models import ComponentState
from roles.database.lifecycle.postgres import PostgresLifecycleManager
from roles.database.lifecycle.supabase import SupabaseLifecycleManager


class FakeDocker:
    def __init__(self):
        self.images = {"db": "supabase/postgres:15.8"}
        self.present = set()
        self.pulled = []
        self.services = ("db", "auth", "rest", "realtime", "storage", "imgproxy", "meta", "studio", "api-gw", "supavisor")
    def compose_service_images(self, *args, **kwargs):
        return dict(self.images)
    def image_id(self, reference):
        return "sha256:test" if reference in self.present else None
    def compose_pull(self, project_dir, env_file, services, **kwargs):
        self.pulled.extend(services)
        for service in services:
            self.present.add(self.images[service])
        return CommandResult(0, "", "")
    def compose_services(self, *args, **kwargs):
        return tuple(self.services)
    def service_container_id(self, *args, **kwargs):
        return None
    def compose_config_json(self, *args, **kwargs):
        return {"services": {name: {"image": f"example/{name}:1"} for name in self.services}}


def profile(root: Path, mode="online") -> EnvironmentConfig:
    return EnvironmentConfig(
        name="test",
        mode=mode,
        nodes={
            "reverse_proxy": NodeConfig(role="reverse_proxy", host="127.0.0.1"),
            "application": NodeConfig(role="application", host="127.0.0.1"),
            "database": NodeConfig(role="database", host="127.0.0.1"),
        },
        database=DatabaseConfig(
            supabase=SupabasePackageConfig(destination=str(root)),
            secret_file=str(root / "secrets.env"),
        ),
    )


class M35LifecycleTests(unittest.TestCase):
    def test_online_image_acquisition_is_idempotent(self):
        with tempfile.TemporaryDirectory() as tmp:
            docker = FakeDocker()
            manager = DatabaseImageManager(docker)
            cfg = profile(Path(tmp))
            self.assertTrue(manager.acquire(cfg))
            self.assertEqual(docker.pulled, ["db"])
            self.assertFalse(manager.acquire(cfg))
            self.assertEqual(docker.pulled, ["db"])

    def test_airgap_never_pulls_missing_image(self):
        with tempfile.TemporaryDirectory() as tmp:
            docker = FakeDocker()
            manager = DatabaseImageManager(docker)
            cfg = profile(Path(tmp), mode="airgap")
            with self.assertRaises(RuntimeError):
                manager.acquire(cfg)
            self.assertEqual(docker.pulled, [])

    def test_existing_unknown_postgres_data_is_blocked(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            data = root / "volumes" / "db" / "data"
            data.mkdir(parents=True)
            (data / "unknown.bin").write_text("data")
            manager = PostgresLifecycleManager(FakeDocker())
            plan = manager.plan(profile(root))
            self.assertTrue(plan["blocked"])
            self.assertEqual(plan["state"], ComponentState.DATA_PRESENT.value)

    def test_recognized_postgres_data_is_not_treated_as_fresh(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            data = root / "volumes" / "db" / "data"
            (data / "base").mkdir(parents=True)
            (data / "PG_VERSION").write_text("15\n")
            manager = PostgresLifecycleManager(FakeDocker())
            state = manager.detect(profile(root))
            self.assertEqual(state.state, ComponentState.DATA_PRESENT)
            self.assertTrue(state.data_present)
            self.assertTrue(state.data_compatible)
            self.assertEqual(state.data_version, "15")

    def test_edge_functions_service_is_hard_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            docker = FakeDocker()
            docker.services = (*docker.services, "functions")
            manager = SupabaseLifecycleManager(docker)
            with self.assertRaises(RuntimeError):
                manager.resolve(profile(Path(tmp)))

    def test_edge_runtime_image_is_hard_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            docker = FakeDocker()
            docker.images["auth"] = "supabase/edge-runtime:v1"
            manager = SupabaseLifecycleManager(docker)
            with self.assertRaises(RuntimeError):
                manager.resolve(profile(Path(tmp)))


if __name__ == "__main__":
    unittest.main()
