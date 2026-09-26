from __future__ import annotations

from core.registry import OperationRegistry
from core.workflow import Workflow

from .tasks import DatabasePackageTask, DatabasePreflightTask, DatabaseSecretsTask


def _registry() -> OperationRegistry:
    registry = OperationRegistry()
    registry.extend((DatabasePreflightTask(), DatabasePackageTask(), DatabaseSecretsTask()))
    return registry


def build_database_preflight_workflow() -> Workflow:
    return Workflow("database.preflight", _registry(), targets=["database.preflight"])


def build_database_material_workflow() -> Workflow:
    return Workflow(
        "database.material",
        _registry(),
        targets=["database.secrets"],
    )
