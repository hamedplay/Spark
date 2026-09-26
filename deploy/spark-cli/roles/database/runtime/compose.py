from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Mapping

from adapters import DockerAdapter
from config.models import EnvironmentConfig
from roles.database.package.overlay import build_database_compose
from roles.database.package.verifier import verify_no_edge_functions
from secrets.file_provider import FileSecretProvider
from .env_builder import SupabaseEnvironmentBuilder

CAPABILITIES = {
    "database": {"db"},
    "auth": {"auth"},
    "rest": {"rest"},
    "realtime": {"realtime"},
    "storage": {"storage"},
    "gateway": {"api-gw", "kong"},
    "studio": {"studio"},
    "pooler": {"supavisor", "pooler"},
}
FORBIDDEN_SERVICES = {"functions"}


def _serialize_env(values: Mapping[str, str]) -> str:
    return "".join(f"{key}={values[key]}\n" for key in sorted(values))


def _atomic_write_private(path: Path, content: str) -> bool:
    previous = path.read_text() if path.exists() else None
    if previous == content:
        if (path.stat().st_mode & 0o777) != 0o600:
            os.chmod(path, 0o600)
            return True
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(tmp_name, 0o600)
        os.replace(tmp_name, path)
        os.chmod(path, 0o600)
        if os.geteuid() == 0:
            os.chown(path, 0, 0)
        return True
    finally:
        if os.path.exists(tmp_name):
            os.unlink(tmp_name)


class DatabaseComposeManager:
    def __init__(self, docker: DockerAdapter | None = None) -> None:
        self.docker = docker or DockerAdapter()
        self.builder = SupabaseEnvironmentBuilder()

    def detect(self, root: str | Path) -> dict[str, object]:
        root = Path(root)
        env_path = root / ".env"
        compose_path = root / "docker-compose.yml"
        env_mode = (env_path.stat().st_mode & 0o777) if env_path.exists() else None
        return {
            "compose_present": compose_path.exists(),
            "env_present": env_path.exists(),
            "env_mode": env_mode,
            "metadata_present": (root / "runtime" / "metadata.json").exists(),
        }

    def materialize(self, profile: EnvironmentConfig, secrets: FileSecretProvider) -> bool:
        root = Path(profile.database.supabase.destination)
        vendor = root / "vendor" / "upstream"
        if not vendor.exists():
            raise RuntimeError("pinned Supabase package must be materialized before database.compose")
        changed = False
        compose_path = root / "docker-compose.yml"
        before_compose = compose_path.read_text() if compose_path.exists() else None
        with tempfile.TemporaryDirectory(prefix="spark-compose-", dir=str(root)) as tmpdir:
            generated = Path(tmpdir) / "docker-compose.yml"
            build_database_compose(vendor / "docker-compose.yml", generated)
            generated_text = generated.read_text()
        if before_compose != generated_text:
            compose_path.write_text(generated_text)
            changed = True
        verify_no_edge_functions(compose_path)

        env_values = self.builder.build(profile, secrets, root)
        changed = _atomic_write_private(root / ".env", _serialize_env(env_values)) or changed
        runtime_dir = root / "runtime"
        runtime_dir.mkdir(parents=True, exist_ok=True)
        metadata = {
            "schema_version": 1,
            "component": "database-compose-runtime",
            "supabase_release": profile.database.supabase.release,
            "edge_functions": False,
        }
        metadata_text = json.dumps(metadata, indent=2, sort_keys=True) + "\n"
        metadata_path = runtime_dir / "metadata.json"
        if not metadata_path.exists() or metadata_path.read_text() != metadata_text:
            metadata_path.write_text(metadata_text)
            changed = True
        return changed

    def verify(self, profile: EnvironmentConfig) -> dict[str, object]:
        root = Path(profile.database.supabase.destination)
        env_path = root / ".env"
        if not env_path.exists() or (env_path.stat().st_mode & 0o777) != 0o600:
            raise RuntimeError("runtime .env is missing or does not have mode 0600")
        verify_no_edge_functions(root / "docker-compose.yml")
        rendered = self.docker.compose_config(root, env_path)
        if "${" in rendered:
            raise RuntimeError("docker compose config contains unresolved interpolation")
        services = set(self.docker.compose_services(root, env_path))
        if services & FORBIDDEN_SERVICES:
            raise RuntimeError("Edge Functions service is forbidden on database role")
        missing = [cap for cap, options in CAPABILITIES.items() if not (services & options)]
        if missing:
            raise RuntimeError(f"database compose missing required capabilities: {', '.join(missing)}")
        return {
            "valid": True,
            "capabilities": tuple(sorted(CAPABILITIES)),
            "service_count": len(services),
            "edge_functions": False,
        }
