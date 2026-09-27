from __future__ import annotations

import os
from pathlib import Path

from config.models import EnvironmentConfig
from secrets.provider import SecretProvider


class ApplicationConfigurationManager:
    def __init__(self, secrets: SecretProvider) -> None:
        self.secrets = secrets

    @staticmethod
    def _database_host(environment: EnvironmentConfig) -> str:
        for _, node in environment.nodes.items():
            if node.role == "database":
                return node.host
        raise ValueError("database node is missing from environment profile")

    def render(self, environment: EnvironmentConfig) -> str:
        db_host = self._database_host(environment)
        values = {
            "DATABASE_HOST": db_host,
            "DATABASE_PORT": "5432",
            "SUPABASE_URL": f"http://{db_host}:8000",
        }
        for key in environment.application.required_secret_keys:
            if not self.secrets.exists(key):
                raise RuntimeError(f"required application secret is missing: {key}")
            values[key] = self.secrets.get(key)
        return "".join(f"{key}={values[key]}\n" for key in sorted(values))

    def materialize(self, environment: EnvironmentConfig) -> bool:
        target = Path(environment.application.runtime_env_file)
        content = self.render(environment)
        if target.exists() and target.read_text() == content:
            return False
        target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        temp = target.with_name(target.name + ".tmp")
        fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        try:
            with os.fdopen(fd, "w") as handle:
                handle.write(content)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temp, target)
            os.chmod(target, 0o600)
        finally:
            if temp.exists():
                temp.unlink(missing_ok=True)
        return True

    def verify(self, environment: EnvironmentConfig) -> bool:
        target = Path(environment.application.runtime_env_file)
        if not target.is_file():
            return False
        return target.stat().st_mode & 0o077 == 0 and target.read_text() == self.render(environment)
