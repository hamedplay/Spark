from __future__ import annotations

from pathlib import Path

from config.loader import load_environment
from core.context import ExecutionContext
from core.operation import OperationTask
from core.result import TaskResult
from roles.database.package import SupabasePackageManager, SupabasePackageSpec


class DatabasePackageTask(OperationTask):
    id = "database.package"
    description = "Materialize the exact pinned Supabase self-hosted package without starting containers."
    dependencies = ("database.preflight",)

    def _spec(self, ctx: ExecutionContext) -> SupabasePackageSpec:
        profile = ctx.variables.get("environment_profile")
        if not profile:
            raise ValueError("environment_profile is required")
        cfg = load_environment(profile).database.supabase
        return SupabasePackageSpec(cfg.release, cfg.source_url, Path(cfg.destination))

    def _manager(self, ctx: ExecutionContext) -> SupabasePackageManager:
        return ctx.variables.get("database_package_manager") or SupabasePackageManager()

    def detect(self, ctx: ExecutionContext) -> TaskResult:
        state = self._manager(ctx).detect(self._spec(ctx))
        ctx.variables["database_package_state"] = state
        return TaskResult.success("database package inspected", **state)

    def plan(self, ctx: ExecutionContext) -> TaskResult:
        plan = self._manager(ctx).plan(self._spec(ctx))
        return TaskResult.success("database package plan", **plan)

    def apply(self, ctx: ExecutionContext) -> TaskResult:
        spec = self._spec(ctx)
        manager = self._manager(ctx)
        before = manager.detect(spec)
        manager.materialize(spec)
        return TaskResult.success("pinned Supabase package materialized", changed=not bool(before["healthy"]), release=spec.release)

    def verify(self, ctx: ExecutionContext) -> TaskResult:
        state = self._manager(ctx).detect(self._spec(ctx))
        if not state["healthy"]:
            return TaskResult.failed("database package verification failed", installed_release=state["installed_release"])
        return TaskResult.success("database package verified", release=state["installed_release"])
