from __future__ import annotations

import os
from pathlib import Path

from config.models import ApplicationCoturnConfig
from secrets.provider import SecretProvider


class CoturnConfigRenderer:
    def __init__(self, secrets: SecretProvider) -> None:
        self.secrets = secrets

    def missing_requirements(self, config: ApplicationCoturnConfig) -> tuple[str, ...]:
        missing: list[str] = []
        if not self.secrets.exists("TURN_SHARED_SECRET"):
            missing.append("TURN_SHARED_SECRET")
        if not config.realm.strip():
            missing.append("application.coturn.realm")
        if not config.certificate_file.strip():
            missing.append("application.coturn.certificate_file")
        elif not Path(config.certificate_file).is_file():
            missing.append("coturn certificate file")
        if not config.key_file.strip():
            missing.append("application.coturn.key_file")
        elif not Path(config.key_file).is_file():
            missing.append("coturn key file")
        return tuple(missing)

    def render(self, config: ApplicationCoturnConfig) -> str:
        missing = self.missing_requirements(config)
        if missing:
            raise RuntimeError("Coturn requirements are missing: " + ", ".join(missing))
        secret = self.secrets.get("TURN_SHARED_SECRET")
        return (
            f"listening-port={config.listener_port}\n"
            f"tls-listening-port={config.tls_port}\n"
            f"min-port={config.relay_min_port}\n"
            f"max-port={config.relay_max_port}\n"
            f"realm={config.realm}\n"
            "fingerprint\n"
            "lt-cred-mech\n"
            "use-auth-secret\n"
            f"static-auth-secret={secret}\n"
            f"cert={config.certificate_file}\n"
            f"pkey={config.key_file}\n"
            "no-cli\n"
            "no-loopback-peers\n"
            "no-multicast-peers\n"
            "stale-nonce=600\n"
        )

    @staticmethod
    def atomic_write(path: Path, content: str) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        temp = path.with_name(path.name + ".tmp")
        fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        try:
            with os.fdopen(fd, "w") as handle:
                handle.write(content)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temp, path)
            os.chmod(path, 0o600)
        finally:
            temp.unlink(missing_ok=True)
