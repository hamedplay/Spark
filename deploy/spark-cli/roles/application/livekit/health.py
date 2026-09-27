from __future__ import annotations

import socket
from dataclasses import dataclass

from config.models import ApplicationLiveKitConfig

from .runtime import LiveKitRuntimeManager


@dataclass(frozen=True)
class LiveKitHealth:
    redis_running: bool
    livekit_running: bool
    api_reachable: bool
    rtc_tcp_reachable: bool
    embedded_turn_disabled: bool

    @property
    def healthy(self) -> bool:
        return all((self.redis_running, self.livekit_running, self.api_reachable, self.rtc_tcp_reachable, self.embedded_turn_disabled))


def _tcp(port: int) -> bool:
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=2):
            return True
    except OSError:
        return False


def inspect_livekit(runtime: LiveKitRuntimeManager, config: ApplicationLiveKitConfig) -> LiveKitHealth:
    return LiveKitHealth(
        redis_running=runtime.container_running("spark-livekit-redis"),
        livekit_running=runtime.container_running("spark-livekit"),
        api_reachable=_tcp(config.api_port),
        rtc_tcp_reachable=_tcp(config.rtc_tcp_port),
        embedded_turn_disabled=not config.embedded_turn,
    )
