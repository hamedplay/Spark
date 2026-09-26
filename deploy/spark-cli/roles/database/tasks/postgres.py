from __future__ import annotations

from config.loader import load_environment
from core.context import ExecutionContext
from core.operation import OperationTask
from core.result import TaskResult
from roles.database.lifecycle.diagnostics import StartupDiagnostics
from roles.database.lifecycle.models import ComponentState
from roles.database.lifecycle.postgres import PostgresLifecycleManager


class DatabasePostgresTask(OperationTask):
    id = "database.postgres"
    description = "Start PostgreSQL independently and enforce container, pg_isready, and SQL health gates."
    dependencies = ("database.images",)
    reverify_on_resume = True

    def _profile(self, ctx: ExecutionContext):
        path = ctx.variables.get("environment_profile")
        if not path:
            raise ValueError("environment_profile is required")
        return load_environment(path)

    def _manager(self, ctx: ExecutionContext) -> PostgresLifecycleManager:
        return ctx.variables.get("database_postgres_manager") or PostgresLifecycleManager()

    def _diagnostics(self, ctx: ExecutionContext) -> StartupDiagnostics:
        return ctx.variables.get("database_diagnostics") or StartupDiagnostics(
            redactor=ctx.variables.get("secret_redactor"),
            log_root=ctx.variables.get("database_log_root", "/var/log/spark-manager/database"),
        )

    def detect(self, ctx: ExecutionContext) -> TaskResult:
        state = self._manager(ctx).detect(self._profile(ctx))
        return TaskResult.success(
            "PostgreSQL runtime inspected",
            state=state.state.value,
            data_present=state.data_present,
            data_version=state.data_version,
            data_compatible=state.data_compatible,
        )

    def plan(self, ctx: ExecutionContext) -> TaskResult:
        plan = self._manager(ctx).plan(self._profile(ctx))
        if plan["blocked"]:
            return TaskResult.failed("PostgreSQL startup plan refused", blocked=plan["blocked"], state=plan["state"])
        return TaskResult.success("PostgreSQL startup plan", actions=plan["actions"], state=plan["state"])

    def apply(self, ctx: ExecutionContext) -> TaskResult:
        try:
            changed = self._manager(ctx).start(self._profile(ctx))
            return TaskResult.success("PostgreSQL started and passed health gate", changed=changed)
        except Exception as exc:
            path = self._diagnostics(ctx).capture(self._profile(ctx), "postgres", "db")
            return TaskResult.failed(f"PostgreSQL startup failed: {type(exc).__name__}", diagnostic=str(path))

    def verify(self, ctx: ExecutionContext) -> TaskResult:
        try:
            state = self._manager(ctx).verify(self._profile(ctx))
        except Exception as exc:
            path = self._diagnostics(ctx).capture(self._profile(ctx), "postgres", "db")
            return TaskResult.failed(f"PostgreSQL health verification failed: {type(exc).__name__}", diagnostic=str(path))
        if state.state != ComponentState.HEALTHY:
            return TaskResult.failed("PostgreSQL is not healthy", state=state.state.value)
        return TaskResult.success(
            "PostgreSQL health gate passed",
            state=state.state.value,
            pg_isready=bool(state.pg_isready),
            sql_probe=bool(state.sql_probe),
        )
