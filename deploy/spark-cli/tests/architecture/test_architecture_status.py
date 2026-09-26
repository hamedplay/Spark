from __future__ import annotations

import unittest
from pathlib import Path

from architecture.connectivity import ConnectivityCheck, ConnectivityStatus
from architecture.status import deployment_readiness
from config.loader import load_environment

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "environments" / "valid.yaml"


class ArchitectureStatusTests(unittest.TestCase):
    def test_not_tested_never_becomes_success(self):
        config = load_environment(FIXTURE)
        checks = [ConnectivityCheck("proxy-to-app", "reverse_proxy", "application", 80, ConnectivityStatus.NOT_TESTED, "not local")]
        status = {item.role: item for item in deployment_readiness(config, checks)}
        self.assertEqual(status["reverse_proxy"].network, "NOT_TESTED")
        self.assertEqual(status["reverse_proxy"].provisioning, "NOT_STARTED")

    def test_failure_is_preserved(self):
        config = load_environment(FIXTURE)
        checks = [ConnectivityCheck("app-to-db", "application", "database", 5432, ConnectivityStatus.FAIL, "refused")]
        status = {item.role: item for item in deployment_readiness(config, checks)}
        self.assertEqual(status["application"].network, "FAIL")


if __name__ == "__main__":
    unittest.main()
