from __future__ import annotations

from dataclasses import dataclass

from adapters.command import CommandRunner
from architecture.host_context import HostContext
from config.models import EnvironmentConfig

from .config import ReverseProxyConfigManager
from .context import ReverseProxyRoleGuardError, require_reverse_proxy_role


@dataclass(frozen=True)
class ReverseProxyPreflight:
    ready: bool
    waiting_for_operator: bool
    missing: tuple[str, ...]
    nginx_installed: bool


def run_reverse_proxy_preflight(environment: EnvironmentConfig, *, host: HostContext | None = None, runner: CommandRunner | None = None) -> ReverseProxyPreflight:
    try:
        require_reverse_proxy_role(environment, host=host)
    except ReverseProxyRoleGuardError:
        return ReverseProxyPreflight(False, False, (), False)
    manager = ReverseProxyConfigManager(runner)
    missing = manager.missing_operator_inputs(environment)
    installed = manager.nginx_installed()
    if not installed and not environment.reverse_proxy.install_nginx_if_missing:
        return ReverseProxyPreflight(False, False, missing, False)
    return ReverseProxyPreflight(not missing, bool(missing), missing, installed)
