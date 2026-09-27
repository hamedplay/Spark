from __future__ import annotations

from dataclasses import dataclass

from adapters.command import CommandRunner
from config.models import EnvironmentConfig

from .config import ReverseProxyConfigManager
from .health import inspect_reverse_proxy


@dataclass(frozen=True)
class ReverseProxyState:
    nginx_installed: bool
    config_matches: bool
    healthy: bool


def detect_reverse_proxy(environment: EnvironmentConfig, runner: CommandRunner | None = None) -> ReverseProxyState:
    manager = ReverseProxyConfigManager(runner)
    installed = manager.nginx_installed()
    if not installed:
        return ReverseProxyState(False, False, False)
    matches = False
    if not manager.missing_operator_inputs(environment):
        matches = manager.config_matches(environment)
    health = inspect_reverse_proxy(environment, runner)
    return ReverseProxyState(True, matches, health.healthy)
