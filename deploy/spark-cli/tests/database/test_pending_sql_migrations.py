from __future__ import annotations

import os
import subprocess
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[2] / "lib" / "database.sh"


class PendingSqlMigrationsTests(unittest.TestCase):
    def pending(self, files: list[str], applied: str, *, database_ok: bool = True):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            migrations = root / "supabase" / "migrations"
            migrations.mkdir(parents=True)
            for name in files:
                (migrations / name).write_text("-- test fixture\n")
            (root / "docker-compose.yml").write_text("services: {}\n")
            env = os.environ | {
                "SPARK_ROOT": tmp,
                "SUPABASE_ROOT": tmp,
                "CURRENT_LOG": str(root / "test.log"),
                "TEST_APPLIED": applied,
                "TEST_DB_OK": "1" if database_ok else "0",
            }
            result = subprocess.run(
                ["bash", "-c", '''
source "$1"
fail() { printf '%s\n' "$*" >&2; }
compose() {
  [[ "$TEST_DB_OK" == 1 ]] || return 1
  printf '%s\n' "$TEST_APPLIED"
}
spark_database_pending_migrations
''', "test-migrations", str(SCRIPT)],
                text=True, capture_output=True, env=env, check=False,
            )
            return result, [Path(line).name for line in result.stdout.splitlines()]

    def test_restored_later_version_does_not_hide_an_earlier_pending_file(self):
        files = ["20261027222141_hardening.sql", "20261028003000_applied.sql"]
        result, pending = self.pending(files, "20261028003000\r\n")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(pending, [files[0]])

    def test_empty_history_returns_all_files_in_order(self):
        result, pending = self.pending(
            ["20261028003000_b.sql", "20261027222141_a.sql", "invalid.sql"], ""
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(pending, ["20261027222141_a.sql", "20261028003000_b.sql"])

    def test_applied_files_are_not_reapplied(self):
        files = ["20261027222141_a.sql", "20261028003000_b.sql"]
        result, pending = self.pending(files, "20261027222141\n20261028003000")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(pending, [])

    def test_invalid_history_fails_closed(self):
        result, pending = self.pending(["20261027222141_a.sql"], "unexpected data")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(pending, [])

    def test_database_failure_does_not_report_every_migration_as_pending(self):
        result, pending = self.pending(["20261027222141_a.sql"], "", database_ok=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(pending, [])


if __name__ == "__main__":
    unittest.main()
