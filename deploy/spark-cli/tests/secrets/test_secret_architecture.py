from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from secrets.file_provider import FileSecretProvider
from secrets.generator import generate_secure_password
from secrets.redaction import SecretRedactor


class FileSecretProviderTests(unittest.TestCase):
    def test_ensure_preserves_existing_secret(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "secrets" / "database.env"
            provider = FileSecretProvider(path)
            first = provider.ensure("POSTGRES_PASSWORD", lambda: "first-value")
            second = provider.ensure("POSTGRES_PASSWORD", lambda: "second-value")
            self.assertEqual(first, "first-value")
            self.assertEqual(second, "first-value")
            self.assertEqual(provider.get("POSTGRES_PASSWORD"), "first-value")

    def test_permissions_are_root_only_modes(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "secrets" / "database.env"
            provider = FileSecretProvider(path)
            provider.set("POSTGRES_PASSWORD", generate_secure_password())
            self.assertEqual(path.parent.stat().st_mode & 0o777, 0o700)
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            provider.validate_storage()

    def test_invalid_permissions_are_detected(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "secrets" / "database.env"
            provider = FileSecretProvider(path)
            provider.set("POSTGRES_PASSWORD", "very-secret")
            path.chmod(0o644)
            self.assertEqual(provider.inspect("POSTGRES_PASSWORD").value, "INVALID")

    def test_redactor_removes_registered_secret_from_uri(self):
        redactor = SecretRedactor()
        redactor.register("VerySecret")
        text = "postgres://postgres:VerySecret@localhost:5432/postgres"
        self.assertEqual(
            redactor.redact(text),
            "postgres://postgres:***@localhost:5432/postgres",
        )


if __name__ == "__main__":
    unittest.main()
