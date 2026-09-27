from __future__ import annotations

import socket
from dataclasses import dataclass

from config.models import ApplicationCoturnConfig

from .runtime import CoturnRuntimeManager


@dataclass(frozen=True)
class CoturnHealth:
    service_active: bool
    listener_reachable: bool
    tls_listener_reachable: bool
    configured: bool

    @property
    def healthy(self) -> bool:
        return self.service_active and self.listener_reachable and self.tls_listener_reachable and self.configured


def _tcp(port: int) -> bool:
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=2):
            return True
    except OSError:
        return False


def inspect_coturn(runtime: CoturnRuntimeManager, config: ApplicationCoturnConfig) -> CoturnHealth:
    return CoturnHealth(
        service_active=runtime.active(config),
        listener_reachable=_tcp(config.listener_port),
        tls_listener_reachable=_tcp(config.tls_port),
        configured=not runtime.missing_requirements(config),
    )
