from __future__ import annotations

from config.loader import load_environment
from core.context import ExecutionContext
from core.operation import OperationTask
from core.result import TaskResult
from core.retry import RetryPolicy
from roles.database.lifecycle.diagnostics import StartupDiagnostics
from roles.database.lifecycle.models import AggregateState
from roles.database.lifecycle.supabase import SupabaseLifecycleManager
from roles.database.lifecycle.postgres import PostgresLifecycleManager
from secrets.file_provider import FileSecretProvider


class DatabaseSupabaseTask(OperationTask):
    id = "database.supabase"
    description = "Start Supabase Core only after the PostgreSQL health gate passes."
    dependencies = ("database.postgres",)
    reverify_on_resume = True

    def _profile(self, ctx: ExecutionContext):
        path = ctx.variables.get("environment_profile")
        if not path:
            raise ValueError("environment_profile is required")
        return load_environment(path)

    def retry_policy_for(self, ctx: ExecutionContext) -> RetryPolicy:
        retry = self._profile(ctx).database.startup.service_retry
        return RetryPolicy(attempts=retry.attempts, delay_seconds=retry.delay_seconds)

    def _manager(self, ctx: ExecutionContext) -> SupabaseLifecycleManager:
        return ctx.variables.get("database_supabase_manager") or SupabaseLifecycleManager()

    def _postgres(self, ctx: ExecutionContext) -> PostgresLifecycleManager:
        return ctx.variables.get("database_postgres_manager") or PostgresLifecycleManager()

    def _provider(self, ctx: ExecutionContext, profile) -> FileSecretProvider:
        return ctx.variables.get("database_secret_provider") or FileSecretProvider(profile.database.secret_file)

    def _diagnostics(self, ctx: ExecutionContext) -> StartupDiagnostics:
        return ctx.variables.get("database_diagnostics") or StartupDiagnostics(
            redactor=ctx.variables.get("secret_redactor"),
            log_root=ctx.variables.get("database_log_root", "/var/log/spark-manager/database"),
        )

    def detect(self, ctx: ExecutionContext) -> TaskResult:
        profile = self._profile(ctx)
        aggregate, states = self._manager(ctx).detect(profile)
        return TaskResult.success(
            "Supabase Core runtime inspected",
            aggregate=aggregate.value,
            services=tuple({"capability": state.capability.value, "service": state.service_name, "state": state.state.value} for state in states),
        )

    def plan(self, ctx: ExecutionContext) -> TaskResult:
        profile = self._profile(ctx)
        try:
            self._postgres(ctx).verify(profile)
        except Exception:
            return TaskResult.failed("Supabase startup blocked: PostgreSQL health gate is not green")
        resolved = self._manager(ctx).resolve(profile)
        return TaskResult.success("Supabase Core startup plan", services=tuple(sorted(resolved.values())), edge_functions=False)

    def apply(self, ctx: ExecutionContext) -> TaskResult:
        profile = self._profile(ctx)
        provider = self._provider(ctx, profile)
        try:
            self._postgres(ctx).verify(profile)
            changed = self._manager(ctx).start(profile, provider)
            return TaskResult.success("Supabase Core started and passed health gate", changed=changed, edge_functions=False)
        except Exception as exc:
            path = self._diagnostics(ctx).capture(profile, "supabase-startup")
            return TaskResult.failed(f"Supabase Core startup failed: {type(exc).__name__}", diagnostic=str(path))

    def verify(self, ctx: ExecutionContext) -> TaskResult:
        profile = self._profile(ctx)
        provider = self._provider(ctx, profile)
        try:
            result = self._manager(ctx).verify(profile, provider)
        except Exception as exc:
            path = self._diagnostics(ctx).capture(profile, "supabase-startup")
            return TaskResult.failed(f"Supabase Core health verification failed: {type(exc).__name__}", diagnostic=str(path))
        if result["aggregate"] != AggregateState.HEALTHY.value:
            return TaskResult.failed("Supabase Core is not healthy", aggregate=result["aggregate"])
        return TaskResult.success("Supabase Core health gate passed", aggregate=result["aggregate"], functional_probes=result["functional_probes"], edge_functions=False)
