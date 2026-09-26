from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from config.loader import load_environment

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "environments"


class ProfileLoaderTests(unittest.TestCase):
    def test_loads_yaml_profile(self):
        config = load_environment(FIXTURES / "valid.yaml")
        self.assertEqual(config.name, "production")
        self.assertEqual(config.nodes["application"].host, "10.0.1.10")
        self.assertEqual(config.nodes["reverse_proxy"].secondary_hosts, ("10.0.0.11",))
        self.assertEqual(len(config.network.rules), 3)

    def test_json_phase1_compatibility(self):
        data = {
            "name": "legacy-json",
            "mode": "online",
            "nodes": {
                "reverse_proxy": {"role": "reverse_proxy", "host": "10.1.0.1"},
                "application": {"role": "application", "host": "10.1.0.2"},
                "database": {"role": "database", "host": "10.1.0.3"},
            },
        }
        with tempfile.TemporaryDirectory() as work:
            path = Path(work) / "environment.json"
            path.write_text(json.dumps(data))
            config = load_environment(path)
        self.assertEqual(config.name, "legacy-json")
        self.assertEqual(config.schema_version, 1)

    def test_secret_keys_are_rejected(self):
        with tempfile.TemporaryDirectory() as work:
            path = Path(work) / "bad.yaml"
            path.write_text((FIXTURES / "valid.yaml").read_text() + "\nJWT_SECRET: forbidden\n")
            with self.assertRaisesRegex(ValueError, "secrets are not allowed"):
                load_environment(path)


if __name__ == "__main__":
    unittest.main()
