from __future__ import annotations

from core.registry import OperationRegistry
from core.workflow import Workflow
from .tasks import DatabaseComposeTask, DatabasePackageTask, DatabasePreflightTask, DatabaseRuntimeTask, DatabaseSecretsTask


def _registry() -> OperationRegistry:
    registry = OperationRegistry()
    registry.extend((DatabasePreflightTask(), DatabasePackageTask(), DatabaseSecretsTask(), DatabaseRuntimeTask(), DatabaseComposeTask()))
    return registry


def build_database_preflight_workflow() -> Workflow:
    return Workflow("database.preflight", _registry(), targets=["database.preflight"])


def build_database_material_workflow() -> Workflow:
    return Workflow("database.material", _registry(), targets=["database.secrets"])


def build_database_runtime_workflow() -> Workflow:
    return Workflow("database.runtime", _registry(), targets=["database.runtime"])


def build_database_compose_workflow() -> Workflow:
    return Workflow("database.compose", _registry(), targets=["database.compose"])
