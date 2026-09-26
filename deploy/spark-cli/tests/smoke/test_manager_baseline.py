from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
import unittest
from pathlib import Path

CLI = Path(__file__).resolve().parents[2]
FIXTURES = CLI / "tests" / "fixtures"
BASELINE = CLI / "tests" / "baseline"


def load_ui():
    spec = importlib.util.spec_from_file_location("spark_ui_phase0_baseline", CLI / "spark-ui.py")
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class ManagerBaselineTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.ui = load_ui()

    def test_python_entrypoints_compile(self):
        for path in (CLI / "spark-ui.py", CLI / "spark-ui-core.py"):
            result = subprocess.run([sys.executable, "-m", "py_compile", str(path)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)

    def test_shell_entrypoints_parse(self):
        for name in ("spark", "spark-airgap", "spark-migrate", "bootstrap.sh", "bootstrap-airgap.sh"):
            result = subprocess.run(["bash", "-n", str(CLI / name)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, f"{name}: {result.stderr}")

    def test_action_registry_matches_baseline(self):
        actual = {
            category: [action.action_id for action in actions]
            for category, actions in self.ui.core.CATEGORIES
        }
        expected = json.loads((FIXTURES / "menu_registry.json").read_text())
        self.assertEqual(actual, expected)

    def test_install_steps_match_baseline(self):
        actual = [
            action.action_id
            for category, actions in self.ui.core.CATEGORIES
            if category == "Installation"
            for action in actions
            if action.action_id.startswith("install-") and action.action_id != "install-all"
        ]
        expected = json.loads((FIXTURES / "install_steps.json").read_text())
        self.assertEqual(actual, expected)

    def test_overview_golden_output(self):
        actual = [
            {
                "id": action.action_id,
                "label": action.label,
                "risk": action.risk,
                "special": action.special,
            }
            for category, actions in self.ui.core.CATEGORIES
            if category == "Overview"
            for action in actions
        ]
        expected = json.loads((BASELINE / "overview.json").read_text())
        self.assertEqual(actual, expected)

    def test_existing_ui_self_test(self):
        self.assertEqual(self.ui.logical_self_test(), 0)


if __name__ == "__main__":
    unittest.main()
