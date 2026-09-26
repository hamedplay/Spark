from __future__ import annotations

import unittest
from pathlib import Path

from config.loader import load_environment

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "environments"


class ProfileSchemaTests(unittest.TestCase):
    def test_invalid_vlan_fails_fast(self):
        with self.assertRaisesRegex(ValueError, "invalid VLAN"):
            load_environment(FIXTURES / "invalid-vlan.yaml")

    def test_missing_database_role_fails_fast(self):
        with self.assertRaisesRegex(ValueError, "missing required architecture roles: database"):
            load_environment(FIXTURES / "missing-database.yaml")

    def test_duplicate_host_fails_fast(self):
        with self.assertRaisesRegex(ValueError, "duplicate host"):
            load_environment(FIXTURES / "duplicate-host.yaml")

    def test_airgap_mode_is_supported(self):
        config = load_environment(FIXTURES / "airgap.yaml")
        self.assertEqual(config.mode, "airgap")


if __name__ == "__main__":
    unittest.main()
