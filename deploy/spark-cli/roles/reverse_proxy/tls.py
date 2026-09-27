from __future__ import annotations

from pathlib import Path

from config.models import ReverseProxyTLSConfig


def tls_ready(config: ReverseProxyTLSConfig) -> bool:
    if config.mode != "provided":
        return False
    return bool(config.certificate_file and config.key_file and Path(config.certificate_file).is_file() and Path(config.key_file).is_file())


def tls_requirements(config: ReverseProxyTLSConfig) -> tuple[str, ...]:
    if config.mode == "acme":
        return ("ACME provisioning is guided/deferred; provide TLS material or complete ACME externally",)
    missing: list[str] = []
    if not config.certificate_file:
        missing.append("certificate_file")
    if not config.key_file:
        missing.append("key_file")
    return tuple(missing)
