from __future__ import annotations

from pathlib import Path
from typing import Mapping

from config.models import EnvironmentConfig
from secrets.file_provider import FileSecretProvider
from secrets.models import REQUIRED_DATABASE_SECRETS


def _read_env_template(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value
    return values


def _host_for_role(profile: EnvironmentConfig, role: str) -> str:
    for node in profile.nodes.values():
        if node.role == role:
            return node.host
    raise ValueError(f"architecture profile missing role: {role}")


class SupabaseEnvironmentBuilder:
    def build(
        self,
        profile: EnvironmentConfig,
        secrets: FileSecretProvider,
        package_root: str | Path,
    ) -> Mapping[str, str]:
        package_root = Path(package_root)
        template = _read_env_template(package_root / ".env.example")
        missing = [key for key in REQUIRED_DATABASE_SECRETS if not secrets.exists(key)]
        if missing:
            raise RuntimeError(f"required database secrets are missing: {', '.join(missing)}")
        for key in REQUIRED_DATABASE_SECRETS:
            template[key] = secrets.get(key)

        database_host = _host_for_role(profile, "database")
        application_host = _host_for_role(profile, "application")
        template.update({
            "POSTGRES_HOST": "db",
            "POSTGRES_PORT": template.get("POSTGRES_PORT", "5432"),
            "POSTGRES_DB": template.get("POSTGRES_DB", "postgres"),
            "API_EXTERNAL_URL": f"http://{database_host}:8000",
            "SUPABASE_PUBLIC_URL": f"http://{database_host}:8000",
            "SITE_URL": f"http://{application_host}",
        })
        return template
