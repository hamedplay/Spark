from __future__ import annotations

from core.registry import OperationRegistry
from core.workflow import Workflow
from .tasks import ApplicationConfigTask, ApplicationPreflightTask, ApplicationSourceTask


def _registry() -> OperationRegistry:
    registry = OperationRegistry()
    registry.extend((ApplicationPreflightTask(), ApplicationSourceTask(), ApplicationConfigTask()))
    return registry


def build_application_preflight_workflow() -> Workflow:
    return Workflow("application.preflight", _registry(), targets=["application.preflight"])


def build_application_source_workflow() -> Workflow:
    return Workflow("application.source", _registry(), targets=["application.source"])


def build_application_foundation_workflow() -> Workflow:
    return Workflow("application.foundation", _registry(), targets=["application.config"])
