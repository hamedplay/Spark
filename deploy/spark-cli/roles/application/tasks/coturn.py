from __future__ import annotations

from config.loader import load_environment
from core.context import ExecutionContext
from core.operation import OperationTask
from core.result import TaskResult
from roles.application.coturn import CoturnRuntimeManager, inspect_coturn
from secrets.file_provider import FileSecretProvider


def _profile(ctx: ExecutionContext):
    path = ctx.variables.get("environment_profile")
    if not path:
        raise ValueError("environment_profile is required")
    return load_environment(path)


class ApplicationCoturnTask(OperationTask):
    id = "application.coturn"
    description = "Provision canonical Coturn TURN service on the Application node."
    dependencies = ("application.livekit",)
    reverify_on_resume = True

    def _runtime(self, ctx):
        env = _profile(ctx)
        provider = ctx.variables.get("application_secret_provider") or FileSecretProvider(env.application.secret_file)
        return ctx.variables.get("application_coturn_runtime") or CoturnRuntimeManager(provider, ctx.variables.get("command_runner"))

    def detect(self, ctx):
        env = _profile(ctx); runtime = self._runtime(ctx)
        missing = runtime.missing_requirements(env.application.coturn)
        health = None if missing else inspect_coturn(runtime, env.application.coturn)
        return TaskResult.success(
            "Coturn inspected",
            configured=not missing,
            installed=runtime.installed(),
            active=(health.service_active if health else False),
            missing=list(missing),
        )

    def plan(self, ctx):
        env = _profile(ctx); runtime = self._runtime(ctx)
        if not env.application.coturn.enabled:
            return TaskResult.failed("Coturn is required by the production topology but is disabled")
        missing = runtime.missing_requirements(env.application.coturn)
        if missing:
            return TaskResult.failed(
                "WAITING_FOR_OPERATOR: Coturn realm/TLS/shared-secret inputs are incomplete",
                waiting_for_operator=True,
                missing=list(missing),
                listener_port=env.application.coturn.listener_port,
                tls_port=env.application.coturn.tls_port,
                relay_range=f"{env.application.coturn.relay_min_port}-{env.application.coturn.relay_max_port}",
            )
        return TaskResult.success(
            "Coturn provision plan",
            install_required=not runtime.installed(),
            listener_port=env.application.coturn.listener_port,
            tls_port=env.application.coturn.tls_port,
            relay_range=f"{env.application.coturn.relay_min_port}-{env.application.coturn.relay_max_port}",
        )

    def apply(self, ctx):
        env = _profile(ctx); runtime = self._runtime(ctx)
        installed = runtime.install()
        configured = runtime.configure(env.application.coturn)
        runtime.start(env.application.coturn)
        return TaskResult.success("Coturn provisioned", changed=installed or configured)

    def verify(self, ctx):
        env = _profile(ctx); runtime = self._runtime(ctx)
        missing = runtime.missing_requirements(env.application.coturn)
        if missing:
            return TaskResult.failed("Coturn still requires operator inputs", waiting_for_operator=True, missing=list(missing))
        health = inspect_coturn(runtime, env.application.coturn)
        if not health.healthy:
            return TaskResult.failed(
                "Coturn health gate failed",
                service=health.service_active,
                listener=health.listener_reachable,
                tls_listener=health.tls_listener_reachable,
                configured=health.configured,
            )
        return TaskResult.success("Coturn verified", listener_port=env.application.coturn.listener_port, tls_port=env.application.coturn.tls_port)
