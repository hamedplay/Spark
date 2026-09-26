from __future__ import annotations

from core.registry import OperationRegistry
from core.workflow import Workflow
from .tasks import (
    DatabaseComposeTask,
    DatabaseImagesTask,
    DatabasePackageTask,
    DatabasePostgresTask,
    DatabasePreflightTask,
    DatabaseRuntimeTask,
    DatabaseSecretsTask,
    DatabaseSupabaseTask,
)


def _registry() -> OperationRegistry:
    registry = OperationRegistry()
    registry.extend((
        DatabasePreflightTask(),
        DatabasePackageTask(),
        DatabaseSecretsTask(),
        DatabaseRuntimeTask(),
        DatabaseComposeTask(),
        DatabaseImagesTask(),
        DatabasePostgresTask(),
        DatabaseSupabaseTask(),
    ))
    return registry


def build_database_preflight_workflow() -> Workflow:
    return Workflow("database.preflight", _registry(), targets=["database.preflight"])


def build_database_material_workflow() -> Workflow:
    return Workflow("database.material", _registry(), targets=["database.secrets"])


def build_database_runtime_workflow() -> Workflow:
    return Workflow("database.runtime", _registry(), targets=["database.runtime"])


def build_database_compose_workflow() -> Workflow:
    return Workflow("database.compose", _registry(), targets=["database.compose"])


def build_database_images_workflow() -> Workflow:
    return Workflow("database.images", _registry(), targets=["database.images"])


def build_database_postgres_workflow() -> Workflow:
    return Workflow("database.postgres", _registry(), targets=["database.postgres"])


def build_database_supabase_workflow() -> Workflow:
    return Workflow("database.supabase", _registry(), targets=["database.supabase"])


def build_database_core_install_workflow() -> Workflow:
    return Workflow("database.install-core", _registry(), targets=["database.supabase"])
