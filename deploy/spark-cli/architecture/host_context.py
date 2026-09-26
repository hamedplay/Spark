from __future__ import annotations

import socket
from dataclasses import dataclass

from config.models import EnvironmentConfig


@dataclass(frozen=True)
class HostContext:
    hostname: str
    addresses: tuple[str, ...]
    detected_role: str | None
    node_name: str | None = None


def local_addresses() -> tuple[str, ...]:
    addresses: set[str] = {"127.0.0.1"}
    hostname = socket.gethostname()
    try:
        for item in socket.getaddrinfo(hostname, None, socket.AF_INET):
            addresses.add(item[4][0])
    except OSError:
        pass
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            sock.connect(("192.0.2.1", 9))
            addresses.add(sock.getsockname()[0])
        finally:
            sock.close()
    except OSError:
        pass
    return tuple(sorted(addresses))


def detect_host_context(config: EnvironmentConfig, addresses: tuple[str, ...] | None = None, hostname: str | None = None) -> HostContext:
    resolved_addresses = tuple(addresses) if addresses is not None else local_addresses()
    address_set = set(resolved_addresses)
    for name, node in config.nodes.items():
        if node.host in address_set or any(host in address_set for host in node.secondary_hosts):
            return HostContext(
                hostname=hostname or socket.gethostname(),
                addresses=resolved_addresses,
                detected_role=node.role,
                node_name=name,
            )
    return HostContext(
        hostname=hostname or socket.gethostname(),
        addresses=resolved_addresses,
        detected_role=None,
        node_name=None,
    )
