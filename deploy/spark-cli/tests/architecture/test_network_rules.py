from __future__ import annotations

import unittest
from pathlib import Path
from unittest import mock

from architecture.connectivity import ConnectivityStatus, check_connectivity
from architecture.host_context import detect_host_context
from config.loader import load_environment

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "environments" / "valid.yaml"


class NetworkRuleTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.config = load_environment(FIXTURE)

    def test_unknown_host_reports_not_tested(self):
        ctx = detect_host_context(self.config, addresses=("192.0.2.5",), hostname="jump")
        checks = check_connectivity(self.config, ctx)
        self.assertTrue(checks)
        self.assertTrue(all(check.status == ConnectivityStatus.NOT_TESTED for check in checks))

    def test_only_local_source_role_is_measured(self):
        ctx = detect_host_context(self.config, addresses=("10.0.1.10",), hostname="app")
        with mock.patch("architecture.connectivity.socket.create_connection") as connect:
            connect.return_value.__enter__.return_value = object()
            checks = check_connectivity(self.config, ctx)
        proxy = [check for check in checks if check.source == "reverse_proxy"]
        app = [check for check in checks if check.source == "application"]
        self.assertTrue(all(check.status == ConnectivityStatus.NOT_TESTED for check in proxy))
        self.assertTrue(all(check.status == ConnectivityStatus.PASS for check in app))
        self.assertEqual(connect.call_count, len(app))


if __name__ == "__main__":
    unittest.main()
