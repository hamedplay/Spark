from __future__ import annotations

import os
from pathlib import Path

from config.models import ApplicationLiveKitConfig
from secrets.provider import SecretProvider


class LiveKitConfigRenderer:
    def __init__(self, secrets: SecretProvider) -> None:
        self.secrets = secrets

    def missing_secrets(self) -> tuple[str, ...]:
        return tuple(key for key in ("LIVEKIT_API_KEY", "LIVEKIT_API_SECRET") if not self.secrets.exists(key))

    def render(self, config: ApplicationLiveKitConfig) -> str:
        missing = self.missing_secrets()
        if missing:
            raise RuntimeError("required LiveKit secrets are missing: " + ", ".join(missing))
        key = self.secrets.get("LIVEKIT_API_KEY")
        secret = self.secrets.get("LIVEKIT_API_SECRET")
        return (
            f"port: {config.api_port}\n"
            "bind_addresses:\n  - 0.0.0.0\n"
            f"keys:\n  {key}: {secret}\n"
            "redis:\n  address: 127.0.0.1:6379\n"
            "rtc:\n"
            f"  tcp_port: {config.rtc_tcp_port}\n"
            f"  port_range_start: {config.rtc_udp_start}\n"
            f"  port_range_end: {config.rtc_udp_end}\n"
            "  use_external_ip: true\n"
            "turn:\n  enabled: false\n"
        )

    @staticmethod
    def atomic_write(path: Path, content: str, mode: int = 0o600) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        temp = path.with_name(path.name + ".tmp")
        fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, mode)
        try:
            with os.fdopen(fd, "w") as handle:
                handle.write(content)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temp, path)
            os.chmod(path, mode)
        finally:
            temp.unlink(missing_ok=True)
