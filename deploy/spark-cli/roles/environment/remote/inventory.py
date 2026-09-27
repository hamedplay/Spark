from __future__ import annotations

from config.models import EnvironmentConfig
from .models import RemoteNode


def build_inventory(environment: EnvironmentConfig) -> tuple[RemoteNode, ...]:
    default_user = (environment.jump_server.ssh_user or "").strip()
    nodes: list[RemoteNode] = []
    for name, node in environment.nodes.items():
        ssh_user = (node.ssh_user or default_user).strip()
        if not ssh_user:
            raise ValueError(f"ssh_user is required in production profile for node {name}")
        hosts = (node.host, *node.secondary_hosts)
        for index, host in enumerate(hosts, start=1):
            node_id = f"{name}-{index}" if len(hosts) > 1 else f"{name}-1"
            nodes.append(RemoteNode(id=node_id, role=node.role, host=host, ssh_user=ssh_user))
    order = {"database": 0, "application": 1, "reverse_proxy": 2}
    return tuple(sorted(nodes, key=lambda item: (order.get(item.role, 99), item.id)))


def by_role(inventory: tuple[RemoteNode, ...], role: str) -> tuple[RemoteNode, ...]:
    return tuple(node for node in inventory if node.role == role)
