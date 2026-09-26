from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from core.context import ExecutionContext
from roles.database.tasks.secrets import DatabaseSecretsTask
from secrets.models import REQUIRED_DATABASE_SECRETS, UPSTREAM_GENERATED_SECRETS


class DatabaseSecretsTaskTests(unittest.TestCase):
    def _profile(self, root: Path) -> Path:
        profile = root / "env.yaml"
        profile.write_text(
            "schema_version: 1\n"
            "environment:\n  name: test\n  mode: online\n"
            "nodes:\n"
            "  reverse_proxy:\n    role: reverse_proxy\n    host: 10.0.0.1\n"
            "  application:\n    role: application\n    host: 10.0.0.2\n"
            "  database:\n    role: database\n    host: 10.0.0.3\n"
            "database:\n"
            "  supabase:\n"
            "    release: self-hosted/v0.8.1\n"
            "    source_url: https://github.com/supabase/supabase.git\n"
            f"    destination: {root / 'package'}\n"
            f"  secret_file: {root / 'secrets' / 'database.env'}\n"
            "network:\n"
            "  rules:\n"
            "    - id: app-db\n      source: application\n      destination: database\n      protocol: tcp\n      ports:\n        - 5432\n"
        )
        return profile

    def test_apply_is_idempotent_and_task_result_does_not_expose_values(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            profile = self._profile(root)
            package_vendor = root / "package" / "vendor" / "upstream"
            package_vendor.mkdir(parents=True)
            generated = {key: f"secret-{index}" for index, key in enumerate(sorted(UPSTREAM_GENERATED_SECRETS), 1)}
            ctx = ExecutionContext(variables={"environment_profile": str(profile)})
            task = DatabaseSecretsTask()
            with patch("roles.database.tasks.secrets.SupabaseUpstreamSecretGenerator.generate", return_value=generated) as upstream:
                first = task.apply(ctx)
                snapshot = (root / "secrets" / "database.env").read_text()
                second = task.apply(ctx)
                self.assertEqual((root / "secrets" / "database.env").read_text(), snapshot)
                self.assertEqual(upstream.call_count, 1)
            self.assertTrue(first.changed)
            self.assertFalse(second.changed)
            combined = first.message + repr(first.details) + second.message + repr(second.details)
            for value in generated.values():
                self.assertNotIn(value, combined)
            self.assertEqual(task.verify(ctx).status.value, "success")
            self.assertEqual(set(REQUIRED_DATABASE_SECRETS), set(task._states(task._provider(ctx))))


if __name__ == "__main__":
    unittest.main()
