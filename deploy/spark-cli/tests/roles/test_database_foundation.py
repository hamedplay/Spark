from __future__ import annotations

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from architecture.host_context import HostContext
from config.models import EnvironmentConfig, NetworkConfig, NetworkRuleConfig, NodeConfig
from roles.database.context import RoleGuardError, require_database_role
from roles.database.detector import ComponentState, detect_database_installation
from roles.database.preflight import PreflightStatus, run_database_preflight


class DatabaseRoleFoundationTests(unittest.TestCase):
    def setUp(self):
        self.environment = EnvironmentConfig(
            name="production",
            nodes={
                "application": NodeConfig(role="application", host="10.211.19.74", vlan=1367),
                "database": NodeConfig(role="database", host="10.211.96.194", vlan=1140),
            },
            network=NetworkConfig(rules=(
                NetworkRuleConfig(
                    rule_id="app-to-database-postgres",
                    source="application",
                    destination="database",
                    protocol="tcp",
                    ports=(5432,),
                ),
            )),
        )
        self.database_host = HostContext("db01", ("10.211.96.194",), "database", "database")
        self.application_host = HostContext("app01", ("10.211.19.74",), "application", "application")

    def test_database_role_guard_accepts_database_node(self):
        ctx = require_database_role(self.environment, host=self.database_host)
        self.assertEqual(ctx.host.detected_role, "database")

    def test_database_role_guard_refuses_application_node(self):
        with self.assertRaises(RoleGuardError) as raised:
            require_database_role(self.environment, host=self.application_host)
        self.assertIn("REFUSED", str(raised.exception))
        self.assertIn("Required node:\n  database", str(raised.exception))

    def test_detector_reports_absent_stack_without_docker(self):
        with TemporaryDirectory() as tmp:
            state = detect_database_installation(tmp, which=lambda _: None)
        self.assertEqual(state.docker, ComponentState.ABSENT)
        self.assertEqual(state.compose, ComponentState.ABSENT)
        self.assertEqual(state.postgres, ComponentState.ABSENT)
        self.assertFalse(state.existing_postgres_data)

    @patch("roles.database.preflight._disk_gib", return_value=120.0)
    @patch("roles.database.preflight._memory_gib", return_value=16.0)
    @patch("roles.database.preflight.os.cpu_count", return_value=8)
    @patch("roles.database.preflight._port_available", return_value=True)
    @patch("roles.database.preflight.detect_database_installation")
    def test_preflight_is_ready_with_actions_when_runtime_missing(
        self, detect, _port, _cpu, _memory, _disk
    ):
        from roles.database.detector import DatabaseInstallationState
        detect.return_value = DatabaseInstallationState(
            docker=ComponentState.ABSENT,
            compose=ComponentState.ABSENT,
            postgres=ComponentState.ABSENT,
            auth=ComponentState.ABSENT,
            rest=ComponentState.ABSENT,
            realtime=ComponentState.ABSENT,
            storage=ComponentState.ABSENT,
            gateway=ComponentState.ABSENT,
            studio=ComponentState.ABSENT,
            supavisor=ComponentState.ABSENT,
            schema=ComponentState.ABSENT,
            install_root="/opt/spark/database/supabase",
            existing_postgres_data=False,
        )
        report = run_database_preflight(self.environment, host=self.database_host)
        statuses = {check.name: check.status for check in report.checks}
        self.assertEqual(report.result, "READY_WITH_ACTIONS")
        self.assertEqual(statuses["Role"], PreflightStatus.PASS)
        self.assertEqual(statuses["Docker"], PreflightStatus.MISSING)
        self.assertEqual(statuses["Compose"], PreflightStatus.MISSING)
        self.assertEqual(statuses["Network"], PreflightStatus.PASS)

    def test_preflight_fails_immediately_on_wrong_role(self):
        report = run_database_preflight(self.environment, host=self.application_host)
        self.assertEqual(report.result, "NOT_READY")
        self.assertEqual(report.checks[0].name, "Role")
        self.assertEqual(report.checks[0].status, PreflightStatus.FAIL)


if __name__ == "__main__":
    unittest.main()
