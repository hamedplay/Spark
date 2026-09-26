from __future__ import annotations

import secrets
import shutil
import string
import subprocess
import tempfile
from pathlib import Path

from .models import UPSTREAM_GENERATED_SECRETS


_ALNUM = string.ascii_letters + string.digits


def generate_secure_password(length: int = 40) -> str:
    return "".join(secrets.choice(_ALNUM) for _ in range(length))


def generate_hex_secret(bytes_count: int = 32) -> str:
    return secrets.token_hex(bytes_count)


def generate_urlsafe_secret(bytes_count: int = 48) -> str:
    return secrets.token_urlsafe(bytes_count)


def generate_dashboard_username() -> str:
    return "supabase"


def generic_generator_for(key: str):
    if key == "DASHBOARD_USERNAME":
        return generate_dashboard_username
    if key in {"POSTGRES_PASSWORD", "DASHBOARD_PASSWORD"}:
        return generate_secure_password
    if key == "SECRET_KEY_BASE":
        return lambda: generate_urlsafe_secret(48)
    if key in {"VAULT_ENC_KEY", "PG_META_CRYPTO_KEY", "LOGFLARE_API_KEY"}:
        return lambda: generate_hex_secret(32)
    return None


def _read_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value
    return values


class SupabaseUpstreamSecretGenerator:
    def __init__(self, vendor_root: str | Path) -> None:
        self.vendor_root = Path(vendor_root)

    def generate(self) -> dict[str, str]:
        env_example = self.vendor_root / ".env.example"
        generate_keys = self.vendor_root / "utils" / "generate-keys.sh"
        add_new_keys = self.vendor_root / "utils" / "add-new-auth-keys.sh"
        for path in (env_example, generate_keys, add_new_keys):
            if not path.exists():
                raise RuntimeError(f"pinned Supabase package missing upstream key tooling: {path.name}")
        with tempfile.TemporaryDirectory(prefix="spark-supabase-keys-") as tmpdir:
            work = Path(tmpdir)
            shutil.copy2(env_example, work / ".env")
            shutil.copytree(self.vendor_root / "utils", work / "utils")
            subprocess.run(
                ["sh", "utils/generate-keys.sh"],
                cwd=work,
                check=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            subprocess.run(
                ["sh", "utils/add-new-auth-keys.sh", "--update-env"],
                cwd=work,
                check=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            values = _read_env(work / ".env")
        result = {key: values[key] for key in UPSTREAM_GENERATED_SECRETS if values.get(key)}
        missing = sorted(UPSTREAM_GENERATED_SECRETS - set(result))
        if missing:
            raise RuntimeError(f"upstream Supabase tooling did not generate required keys: {', '.join(missing)}")
        return result
