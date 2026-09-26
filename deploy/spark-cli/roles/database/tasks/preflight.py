from __future__ import annotations

from core.context import ExecutionContext
from core.operation import OperationTask
from core.result import TaskResult

from config.loader import load_environment
from roles.database.preflight import run_database_preflight


class DatabasePreflightTask(OperationTask):
    id = "database.preflight"
    description = "Validate database-node readiness without changing the system."

    def _profile(self, ctx: ExecutionContext):
        path = ctx.variables.get("environment_profile")
        if not path:
            raise ValueError("environment_profile is required")
        return load_environment(path)

    def detect(self, ctx: ExecutionContext) -> TaskResult:
        report = run_database_preflight(
            self._profile(ctx),
            host=ctx.variables.get("host_context"),
            install_root=ctx.variables.get("database_install_root", "/opt/spark/database/supabase"),
            min_cpu=int(ctx.variables.get("database_min_cpu", 2)),
            recommended_cpu=int(ctx.variables.get("database_recommended_cpu", 4)),
            min_memory_gib=float(ctx.variables.get("database_min_memory_gib", 4.0)),
            recommended_memory_gib=float(ctx.variables.get("database_recommended_memory_gib", 8.0)),
            min_disk_gib=float(ctx.variables.get("database_min_disk_gib", 40.0)),
            recommended_disk_gib=float(ctx.variables.get("database_recommended_disk_gib", 80.0)),
        )
        ctx.variables["database_preflight_report"] = report
        if not report.ready:
            failed = [check.name for check in report.checks if check.status.value == "FAIL"]
            return TaskResult.failed("database preflight failed", checks=failed, result=report.result)
        return TaskResult.success("database preflight detected", result=report.result)

    def plan(self, ctx: ExecutionContext) -> TaskResult:
        report = ctx.variables.get("database_preflight_report")
        if report is None:
            report = run_database_preflight(self._profile(ctx), host=ctx.variables.get("host_context"))
            ctx.variables["database_preflight_report"] = report
        actions = [check.name for check in report.checks if check.status.value in {"WARN", "MISSING"}]
        return TaskResult.success("database preflight plan", actions=actions, result=report.result)

    def apply(self, ctx: ExecutionContext) -> TaskResult:
        return TaskResult.success("preflight is read-only; no changes applied", changed=False)

    def verify(self, ctx: ExecutionContext) -> TaskResult:
        report = ctx.variables.get("database_preflight_report")
        if report is None:
            return TaskResult.failed("database preflight report is missing")
        if not report.ready:
            return TaskResult.failed("database preflight verification failed", result=report.result)
        return TaskResult.success("database preflight verified", result=report.result)
