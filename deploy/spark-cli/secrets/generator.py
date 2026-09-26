from __future__ import annotations

import secrets
import string


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
