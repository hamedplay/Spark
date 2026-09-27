from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from architecture.host_context import HostContext
from config.models import ApplicationConfig, ApplicationSourceConfig, EnvironmentConfig, NodeConfig
from roles.application.configuration import ApplicationConfigurationManager
from roles.application.context import ApplicationRoleGuardError, require_application_role
from roles.application.detector import ComponentState, detect_application_installation
from roles.application.source import ApplicationSourceManager


class FakeSecrets:
    def __init__(self, values): self.values = values
    def exists(self, key): return bool(self.values.get(key))
    def get(self, key): return self.values[key]
    def set(self, key, value): self.values[key] = value
    def ensure(self, key, generator): return self.values.setdefault(key, generator())


class FakeRunner:
    def __init__(self): self.calls = []
    def run(self, args, **kwargs):
        self.calls.append(tuple(args))
        class R: pass
        r = R(); r.returncode = 0; r.stderr = ""
        r.stdout = "a" * 40 + "\trefs/heads/main\n" if args[:2] == ("git", "ls-remote") else ""
        return r


class ApplicationFoundationTests(unittest.TestCase):
    def _env(self, root: str) -> EnvironmentConfig:
        return EnvironmentConfig(
            name="test",
            nodes={
                "application": NodeConfig(role="application", host="10.0.0.10"),
                "database": NodeConfig(role="database", host="10.0.0.20"),
            },
            application=ApplicationConfig(
                source=ApplicationSourceConfig(
                    repository="https://example.invalid/Spark.git",
                    revision="main",
                    releases_root=f"{root}/releases",
                    current_link=f"{root}/current",
                    shared_root=f"{root}/shared",
                ),
                runtime_env_file=f"{root}/shared/runtime.env",
                required_secret_keys=("SERVICE_ROLE_KEY",),
            ),
        )

    def test_role_guard_refuses_wrong_node(self):
        env = self._env("/tmp/x")
        with self.assertRaises(ApplicationRoleGuardError):
            require_application_role(env, host=HostContext("db", ("10.0.0.20",), "database", "database"))
        ctx = require_application_role(env, host=HostContext("app", ("10.0.0.10",), "application", "application"))
        self.assertEqual(ctx.host.detected_role, "application")

    def test_source_revision_is_resolved_to_commit(self):
        env = self._env("/tmp/x")
        runner = FakeRunner()
        plan = ApplicationSourceManager(runner).resolve(env.application.source)
        self.assertEqual(plan.resolved_commit, "a" * 40)
        self.assertTrue(plan.release_path.endswith("/" + "a" * 40))

    def test_runtime_config_separates_topology_and_secret_values(self):
        with tempfile.TemporaryDirectory() as tmp:
            env = self._env(tmp)
            manager = ApplicationConfigurationManager(FakeSecrets({"SERVICE_ROLE_KEY": "secret-value"}))
            changed = manager.materialize(env)
            self.assertTrue(changed)
            target = Path(env.application.runtime_env_file)
            self.assertEqual(target.stat().st_mode & 0o777, 0o600)
            text = target.read_text()
            self.assertIn("DATABASE_HOST=10.0.0.20", text)
            self.assertIn("SUPABASE_URL=http://10.0.0.20:8000", text)
            self.assertIn("SERVICE_ROLE_KEY=secret-value", text)
            self.assertFalse(manager.materialize(env))
            self.assertTrue(manager.verify(env))

    def test_detector_is_non_destructive(self):
        with tempfile.TemporaryDirectory() as tmp:
            state = detect_application_installation(f"{tmp}/releases", f"{tmp}/current", f"{tmp}/shared/runtime.env")
            self.assertEqual(state.source, ComponentState.ABSENT)
            self.assertEqual(state.runtime_config, ComponentState.ABSENT)


if __name__ == "__main__":
    unittest.main()
