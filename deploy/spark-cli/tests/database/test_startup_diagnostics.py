from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from adapters.command import CommandResult
from config.models import DatabaseConfig, EnvironmentConfig, NodeConfig, SupabasePackageConfig
from roles.database.lifecycle.diagnostics import StartupDiagnostics
from secrets.redaction import SecretRedactor


class FakeRunner:
    def run(self, args, **kwargs):
        return CommandResult(0, "ok\n", "")


class FakeDocker:
    def __init__(self, secret):
        self.runner = FakeRunner()
        self.secret = secret
    def compose_ps(self, *args, **kwargs):
        return "service healthy"
    def compose_services(self, *args, **kwargs):
        return ("db", "auth")
    def service_container_id(self, *args, **kwargs):
        return "cid"
    def container_state(self, *args, **kwargs):
        return "running", "unhealthy"
    def compose_logs(self, *args, **kwargs):
        return f"postgres://postgres:{self.secret}@db:5432/postgres"


class StartupDiagnosticsTests(unittest.TestCase):
    def test_secret_is_absent_from_diagnostic_file(self):
        secret = "VerySecretValue"
        redactor = SecretRedactor()
        redactor.register(secret)
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            profile = EnvironmentConfig(
                name="test",
                nodes={
                    "reverse_proxy": NodeConfig(role="reverse_proxy", host="10.0.0.1"),
                    "application": NodeConfig(role="application", host="10.0.0.2"),
                    "database": NodeConfig(role="database", host="10.0.0.3"),
                },
                database=DatabaseConfig(
                    supabase=SupabasePackageConfig(destination=str(root / "supabase")),
                    secret_file=str(root / "database.env"),
                ),
            )
            path = StartupDiagnostics(FakeDocker(secret), redactor, root / "logs").capture(profile, "postgres", "db")
            content = path.read_text()
            self.assertNotIn(secret, content)
            self.assertIn("***", content)
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)


if __name__ == "__main__":
    unittest.main()
