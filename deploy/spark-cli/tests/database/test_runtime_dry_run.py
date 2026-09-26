from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from core.context import ExecutionContext
from core.operation import OperationTask
from core.registry import OperationRegistry
from core.result import TaskResult
from core.workflow import Workflow
from roles.database.runtime.models import DockerRuntimeState, RuntimeStatus
from roles.database.tasks import DatabaseComposeTask, DatabaseRuntimeTask


class StubSecretsTask(OperationTask):
    id = "database.secrets"
    def detect(self, ctx): return TaskResult.success("ok")
    def plan(self, ctx): return TaskResult.success("ok")
    def apply(self, ctx): return TaskResult.success("ok")
    def verify(self, ctx): return TaskResult.success("ok")


class FakeRuntimeManager:
    def __init__(self): self.apply_calls = 0
    def detect(self):
        return DockerRuntimeState(
            status=RuntimeStatus.ABSENT, os_id="ubuntu", os_version="24.04", os_codename="noble",
            architecture="amd64", engine_installed=False, engine_version=None, daemon_active=False,
            daemon_healthy=False, compose_installed=False, compose_version=None, source=None,
            conflicting_packages=(), socket_path=None, firewall_warnings=(),
        )
    def plan(self, policy):
        return {"status": "ABSENT", "actions": ("install runtime",), "blocked": (), "firewall_warnings": ()}
    def apply(self, policy):
        self.apply_calls += 1
        return True


class FakeComposeManager:
    def __init__(self): self.apply_calls = 0
    def detect(self, root):
        return {"compose_present": False, "env_present": False, "env_mode": None, "metadata_present": False, "volumes_present": False}
    def materialize(self, profile, secrets):
        self.apply_calls += 1
        return True
    def verify(self, profile):
        return {"service_count": 8, "capabilities": (), "edge_functions": False}


class RuntimeDryRunTests(unittest.TestCase):
    def test_dry_run_skips_runtime_and_compose_apply(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            profile = Path(tmpdir) / "profile.json"
            profile.write_text(json.dumps({
                "schema_version": 1,
                "environment": {"name": "test", "mode": "online"},
                "nodes": {
                    "reverse_proxy": {"role": "reverse_proxy", "host": "10.0.0.1"},
                    "application": {"role": "application", "host": "10.0.0.2"},
                    "database": {"role": "database", "host": "10.0.0.3"}
                },
                "network": {"rules": [{"id": "app-db", "source": "application", "destination": "database", "protocol": "tcp", "ports": [5432]}]},
                "database": {"supabase": {"release": "self-hosted/v0.8.1", "destination": str(Path(tmpdir) / "supabase")}, "secret_file": str(Path(tmpdir) / "secrets.env")}
            }))
            runtime = FakeRuntimeManager()
            compose = FakeComposeManager()
            registry = OperationRegistry()
            registry.extend((StubSecretsTask(), DatabaseRuntimeTask(), DatabaseComposeTask()))
            workflow = Workflow("m34-dry-run", registry, targets=["database.compose"])
            ctx = ExecutionContext(dry_run=True, variables={
                "environment_profile": str(profile),
                "database_runtime_manager": runtime,
                "database_compose_manager": compose,
            })
            result = workflow.execute(ctx)
            self.assertTrue(result.ok)
            self.assertEqual(runtime.apply_calls, 0)
            self.assertEqual(compose.apply_calls, 0)


if __name__ == "__main__":
    unittest.main()
