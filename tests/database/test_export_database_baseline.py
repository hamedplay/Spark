import importlib.util
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


spec = importlib.util.spec_from_file_location(
    "export_baseline", Path(__file__).resolve().parents[2] / "scripts" / "export-database-baseline.py"
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class BaselineExportTests(unittest.TestCase):
    def test_export_preserves_acl_and_omits_business_data_and_migration_bodies(self):
        calls = []

        def run(args, **kwargs):
            calls.append(args)
            if args[0] == "pg_dump":
                Path(args[args.index("--file") + 1]).write_text("-- schema fixture\n")
                return subprocess.CompletedProcess(args, 0)
            return subprocess.CompletedProcess(args, 0, "17.11\n" if "SHOW server_version" in args else "-- history fixture\n", "")

        with tempfile.TemporaryDirectory() as tmp, patch.object(module.subprocess, "run", side_effect=run):
            target = Path(tmp) / "baseline"
            module.export_baseline(target)
            manifest = json.loads((target / "manifest.json").read_text())
            self.assertFalse(manifest["application_data_included"])
            self.assertTrue(manifest["privileges_included"])
            self.assertIn("--schema-only", calls[0])
            self.assertNotIn("--no-acl", calls[0])
            self.assertNotIn("--no-owner", calls[0])
            self.assertNotIn("statements", module.HISTORY_SQL)
            self.assertEqual(len(manifest["files"]["schema.sql"]), 64)
            with self.assertRaises(FileExistsError):
                module.export_baseline(target)

    def test_failed_dump_does_not_publish_a_partial_baseline(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(
            module.subprocess, "run", side_effect=subprocess.CalledProcessError(1, "pg_dump")
        ):
            target = Path(tmp) / "baseline"
            with self.assertRaises(subprocess.CalledProcessError):
                module.export_baseline(target)
            self.assertFalse(target.exists())
            self.assertEqual(list(Path(tmp).iterdir()), [])


if __name__ == "__main__":
    unittest.main()
