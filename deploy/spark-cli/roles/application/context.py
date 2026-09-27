from __future__ import annotations

from dataclasses import dataclass

from architecture.host_context import HostContext, detect_host_context
from config.models import EnvironmentConfig


class ApplicationRoleGuardError(RuntimeError):
    pass


@dataclass(frozen=True)
class ApplicationRoleContext:
    environment: EnvironmentConfig
    host: HostContext

    @property
    def application_node(self):
        for name, node in self.environment.nodes.items():
            if node.role == "application":
                return name, node
        return None, None


def require_application_role(environment: EnvironmentConfig, *, host: HostContext | None = None) -> ApplicationRoleContext:
    resolved = host or detect_host_context(environment)
    if resolved.detected_role != "application":
        current = resolved.detected_role or "UNKNOWN"
        raise ApplicationRoleGuardError(
            "REFUSED\n\nOperation:\n  application.provision\n\n"
            f"Current node:\n  {current}\n\nRequired node:\n  application"
        )
    return ApplicationRoleContext(environment=environment, host=resolved)
