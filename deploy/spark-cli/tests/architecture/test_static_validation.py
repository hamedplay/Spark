from __future__ import annotations

import unittest
from pathlib import Path

from architecture.validator import ValidationStatus, validate_architecture
from config.loader import load_environment

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "environments" / "valid.yaml"


class StaticValidationTests(unittest.TestCase):
    def test_valid_profile_reports_required_roles(self):
        report = validate_architecture(load_environment(FIXTURE))
        self.assertTrue(report.ok)
        by_check = {item.check: item for item in report.issues}
        for role in ("reverse_proxy", "application", "database"):
            self.assertEqual(by_check[f"role-{role}"].status, ValidationStatus.PASS)
        self.assertEqual(by_check["jump-server"].status, ValidationStatus.NOT_TESTED)


if __name__ == "__main__":
    unittest.main()
