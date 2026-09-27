from __future__ import annotations

from core.registry import OperationRegistry
from core.workflow import Workflow
from .tasks import ReverseProxyPreflightTask, ReverseProxyProvisionTask


def build_reverse_proxy_workflow() -> Workflow:
    registry = OperationRegistry()
    registry.extend((ReverseProxyPreflightTask(), ReverseProxyProvisionTask()))
    return Workflow("reverse-proxy.provision", registry, targets=["reverse-proxy.provision"])
