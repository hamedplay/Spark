from __future__ import annotations

from config.loader import load_environment
from core.context import ExecutionContext
from core.operation import OperationTask
from core.result import TaskResult
from roles.database.runtime.compose import DatabaseComposeManager
from secrets.file_provider import FileSecretProvider


class DatabaseComposeTask(OperationTask):
    id = "database.compose"
    description = "Build and validate the database Supabase runtime environment without starting services."
    dependencies = ("database.runtime",)

    def _profile(self, ctx: ExecutionContext):
        path = ctx.variables.get("environment_profile")
        if not path:
            raise ValueError("environment_profile is required")
        return load_environment(path)

    def _manager(self, ctx: ExecutionContext) -> DatabaseComposeManager:
        return ctx.variables.get("database_compose_manager") or DatabaseComposeManager()

    def _secrets(self, ctx: ExecutionContext, profile):
        return ctx.variables.get("database_secret_provider") or FileSecretProvider(profile.database.secret_file)

    def detect(self, ctx: ExecutionContext) -> TaskResult:
        profile = self._profile(ctx)
        state = self._manager(ctx).detect(profile.database.supabase.destination)
        ctx.variables["database_compose_state"] = state
        return TaskResult.success("database compose inspected", **state)

    def plan(self, ctx: ExecutionContext) -> TaskResult:
        profile = self._profile(ctx)
        state = self._manager(ctx).detect(profile.database.supabase.destination)
        actions: list[str] = []
        if not state["compose_present"]:
            actions.append("materialize database docker-compose.yml")
        if not state["env_present"] or state["env_mode"] != 0o600:
            actions.append("generate private runtime .env")
        if not state["metadata_present"]:
            actions.append("write runtime metadata")
        if not actions:
            actions.append("validate existing compose artifact")
        return TaskResult.success("database compose plan", actions=tuple(actions))

    def apply(self, ctx: ExecutionContext) -> TaskResult:
        profile = self._profile(ctx)
        changed = self._manager(ctx).materialize(profile, self._secrets(ctx, profile))
        return TaskResult.success("database compose runtime materialized", changed=changed)

    def verify(self, ctx: ExecutionContext) -> TaskResult:
        profile = self._profile(ctx)
        try:
            result = self._manager(ctx).verify(profile)
        except RuntimeError as exc:
            return TaskResult.failed(str(exc))
        return TaskResult.success(
            "database compose runtime verified",
            service_count=result["service_count"],
            capabilities=result["capabilities"],
            edge_functions=False,
        )

    def rollback(self, ctx: ExecutionContext) -> TaskResult:
        return TaskResult.success("compose rollback is limited to generated runtime artifacts", changed=False)
