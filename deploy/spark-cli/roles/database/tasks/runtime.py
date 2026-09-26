from __future__ import annotations

from config.loader import load_environment
from core.context import ExecutionContext
from core.operation import OperationTask
from core.result import TaskResult
from roles.database.runtime import DockerRuntimeManager, RuntimeStatus


class DatabaseRuntimeTask(OperationTask):
    id = "database.runtime"
    description = "Prepare and verify Docker Engine and Compose plugin for the database role."
    dependencies = ("database.secrets",)

    def _profile(self, ctx: ExecutionContext):
        path = ctx.variables.get("environment_profile")
        if not path:
            raise ValueError("environment_profile is required")
        return load_environment(path)

    def _manager(self, ctx: ExecutionContext) -> DockerRuntimeManager:
        return ctx.variables.get("database_runtime_manager") or DockerRuntimeManager()

    def detect(self, ctx: ExecutionContext) -> TaskResult:
        state = self._manager(ctx).detect()
        ctx.variables["database_runtime_state"] = state
        return TaskResult.success(
            "database runtime inspected",
            status=state.status.value,
            engine_version=state.engine_version,
            compose_version=state.compose_version,
            conflicts=state.conflicting_packages,
            firewall_warnings=state.firewall_warnings,
        )

    def plan(self, ctx: ExecutionContext) -> TaskResult:
        plan = self._manager(ctx).plan(self._profile(ctx).runtime.docker)
        if plan["blocked"]:
            return TaskResult.failed("database runtime plan blocked", blocked=plan["blocked"], status=plan["status"])
        return TaskResult.success(
            "database runtime plan",
            actions=plan["actions"],
            status=plan["status"],
            firewall_warnings=plan["firewall_warnings"],
        )

    def apply(self, ctx: ExecutionContext) -> TaskResult:
        changed = self._manager(ctx).apply(self._profile(ctx).runtime.docker)
        return TaskResult.success("database Docker runtime prepared", changed=changed)

    def verify(self, ctx: ExecutionContext) -> TaskResult:
        state = self._manager(ctx).detect()
        if state.status != RuntimeStatus.HEALTHY or not state.compose_installed:
            return TaskResult.failed("database Docker runtime verification failed", status=state.status.value)
        return TaskResult.success(
            "database Docker runtime verified",
            engine_version=state.engine_version,
            compose_version=state.compose_version,
            firewall_warnings=state.firewall_warnings,
        )

    def rollback(self, ctx: ExecutionContext) -> TaskResult:
        return TaskResult.success("runtime rollback is intentionally non-mutating", changed=False)
