from __future__ import annotations

from dataclasses import dataclass

from architecture.host_context import HostContext, detect_host_context
from config.models import EnvironmentConfig


class RoleGuardError(RuntimeError):
    """Raised before any provisioning action when the current node has the wrong role."""


@dataclass(frozen=True)
class DatabaseRoleContext:
    environment: EnvironmentConfig
    host: HostContext

    @property
    def database_node(self):
        for name, node in self.environment.nodes.items():
            if node.role == "database":
                return name, node
        return None, None


def require_database_role(
    environment: EnvironmentConfig,
    *,
    host: HostContext | None = None,
) -> DatabaseRoleContext:
    resolved = host or detect_host_context(environment)
    if resolved.detected_role != "database":
        current = resolved.detected_role or "UNKNOWN"
        raise RoleGuardError(
            "REFUSED\n\n"
            "Operation:\n  database.install\n\n"
            f"Current node:\n  {current}\n\n"
            "Required node:\n  database"
        )
    return DatabaseRoleContext(environment=environment, host=resolved)
