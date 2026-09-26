from __future__ import annotations

import unittest
from pathlib import Path

from architecture.host_context import detect_host_context
from config.loader import load_environment

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "environments" / "valid.yaml"


class RoleDetectionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.config = load_environment(FIXTURE)

    def test_detects_application_role(self):
        ctx = detect_host_context(self.config, addresses=("10.0.1.10",), hostname="app")
        self.assertEqual(ctx.detected_role, "application")
        self.assertEqual(ctx.node_name, "application")

    def test_detects_secondary_reverse_proxy_host(self):
        ctx = detect_host_context(self.config, addresses=("10.0.0.11",), hostname="proxy-b")
        self.assertEqual(ctx.detected_role, "reverse_proxy")

    def test_unknown_host_is_explicit(self):
        ctx = detect_host_context(self.config, addresses=("192.0.2.55",), hostname="jump")
        self.assertIsNone(ctx.detected_role)
        self.assertIsNone(ctx.node_name)


if __name__ == "__main__":
    unittest.main()
