from __future__ import annotations

from pathlib import Path

from config.loader import load_environment
from core.context import ExecutionContext
from core.operation import OperationTask
from core.result import TaskResult
from secrets.file_provider import FileSecretProvider
from secrets.generator import SupabaseUpstreamSecretGenerator, generic_generator_for
from secrets.models import REQUIRED_DATABASE_SECRETS, UPSTREAM_GENERATED_SECRETS
from secrets.redaction import SecretRedactor


class DatabaseSecretsTask(OperationTask):
    id = "database.secrets"
    description = "Ensure database secrets exist in the root-only secret store without exposing values."
    dependencies = ("database.package",)

    def _config(self, ctx: ExecutionContext):
        profile = ctx.variables.get("environment_profile")
        if not profile:
            raise ValueError("environment_profile is required")
        return load_environment(profile).database

    def _provider(self, ctx: ExecutionContext) -> FileSecretProvider:
        provider = ctx.variables.get("database_secret_provider")
        if provider is not None:
            return provider
        return FileSecretProvider(self._config(ctx).secret_file)

    def _states(self, provider: FileSecretProvider) -> dict[str, str]:
        return {key: provider.inspect(key).value for key in REQUIRED_DATABASE_SECRETS}

    def detect(self, ctx: ExecutionContext) -> TaskResult:
        states = self._states(self._provider(ctx))
        ctx.variables["database_secret_states"] = states
        return TaskResult.success("database secrets inspected", states=states)

    def plan(self, ctx: ExecutionContext) -> TaskResult:
        states = ctx.variables.get("database_secret_states") or self._states(self._provider(ctx))
        missing = [key for key, state in states.items() if state == "MISSING"]
        invalid = [key for key, state in states.items() if state == "INVALID"]
        if invalid:
            return TaskResult.failed("database secret storage contains invalid entries", invalid=invalid)
        return TaskResult.success("database secrets plan", missing=missing)

    def apply(self, ctx: ExecutionContext) -> TaskResult:
        provider = self._provider(ctx)
        changed = False
        for key in REQUIRED_DATABASE_SECRETS:
            generator = generic_generator_for(key)
            if generator is not None and not provider.exists(key):
                provider.ensure(key, generator)
                changed = True

        missing_upstream = [key for key in UPSTREAM_GENERATED_SECRETS if not provider.exists(key)]
        if missing_upstream:
            destination = Path(self._config(ctx).supabase.destination)
            vendor = destination / "vendor" / "upstream"
            generated = SupabaseUpstreamSecretGenerator(vendor).generate()
            for key in missing_upstream:
                provider.set(key, generated[key])
                changed = True

        redactor = ctx.variables.get("secret_redactor") or SecretRedactor()
        redactor.register_many(provider.get(key) for key in REQUIRED_DATABASE_SECRETS if provider.exists(key))
        ctx.variables["secret_redactor"] = redactor
        return TaskResult.success("database secrets ensured", changed=changed, secret_ref="database.*")

    def verify(self, ctx: ExecutionContext) -> TaskResult:
        provider = self._provider(ctx)
        states = self._states(provider)
        missing = [key for key, state in states.items() if state != "PRESENT"]
        if missing:
            return TaskResult.failed("database secrets verification failed", keys=missing)
        try:
            provider.validate_storage()
        except PermissionError as exc:
            return TaskResult.failed(f"database secret storage permissions invalid: {exc}")
        return TaskResult.success("database secrets verified", secret_ref="database.*")
