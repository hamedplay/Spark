from __future__ import annotations

from core.registry import OperationRegistry
from core.workflow import Workflow

from .tasks import DatabasePreflightTask


def build_database_preflight_workflow() -> Workflow:
    registry = OperationRegistry()
    registry.register(DatabasePreflightTask())
    return Workflow("database.preflight", registry, targets=["database.preflight"])
