from __future__ import annotations

from config.models import EnvironmentConfig
from .host_context import HostContext


def _node_line(config: EnvironmentConfig, role: str) -> list[str]:
    for node in config.nodes.values():
        if node.role == role:
            hosts = ", ".join((node.host, *node.secondary_hosts))
            vlan = f"VLAN {node.vlan}" if node.vlan is not None else "VLAN n/a"
            return [role.replace("_", " ").upper(), f"  {hosts}", f"  {vlan}"]
    return [role.replace("_", " ").upper(), "  NOT CONFIGURED"]


def render_architecture_overview(config: EnvironmentConfig, host_context: HostContext) -> list[str]:
    lines = [
        "SPARK ARCHITECTURE",
        "",
        "INTERNET",
        "   |",
        "   | HTTPS / 443",
        "   v",
        *_node_line(config, "reverse_proxy"),
        "   |",
        "   | HTTP / 80",
        "   v",
        *_node_line(config, "application"),
        "   |",
        "   | PostgreSQL / 5432",
        "   v",
        *_node_line(config, "database"),
        "",
        f"Environment        {config.name}",
        f"Mode               {config.mode.upper()}",
        f"Current Role       {host_context.detected_role or 'UNKNOWN'}",
        f"Current Host       {host_context.hostname}",
        f"Network Rules      {len(config.network.rules)}",
    ]
    return lines
