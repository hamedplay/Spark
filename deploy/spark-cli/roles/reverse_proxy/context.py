from __future__ import annotations

from dataclasses import dataclass

from architecture.host_context import HostContext, detect_host_context
from config.models import EnvironmentConfig


class ReverseProxyRoleGuardError(RuntimeError):
    pass


@dataclass(frozen=True)
class ReverseProxyRoleContext:
    environment: EnvironmentConfig
    host: HostContext


def require_reverse_proxy_role(environment: EnvironmentConfig, *, host: HostContext | None = None) -> ReverseProxyRoleContext:
    resolved = host or detect_host_context(environment)
    if resolved.detected_role != "reverse_proxy":
        current = resolved.detected_role or "UNKNOWN"
        raise ReverseProxyRoleGuardError(
            "REFUSED\n\nOperation:\n  reverse-proxy.provision\n\n"
            f"Current node:\n  {current}\n\nRequired node:\n  reverse_proxy"
        )
    return ReverseProxyRoleContext(environment=environment, host=resolved)
