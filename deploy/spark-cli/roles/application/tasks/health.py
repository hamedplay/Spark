from __future__ import annotations

from pathlib import Path

from config.loader import load_environment
from core.context import ExecutionContext
from core.operation import OperationTask
from core.result import TaskResult
from roles.application.build.manifest import load_build_manifest
from roles.application.coturn import CoturnRuntimeManager, inspect_coturn
from roles.application.deployment.health import StaticHealthGate
from roles.application.edge import EdgeRuntimeManager, EdgeVerifier
from roles.application.livekit import LiveKitRuntimeManager, inspect_livekit
from roles.application.source import ApplicationSourceManager
from secrets.file_provider import FileSecretProvider


def _profile(ctx: ExecutionContext):
    path = ctx.variables.get("environment_profile")
    if not path:
        raise ValueError("environment_profile is required")
    return load_environment(path)


def _source_plan(ctx: ExecutionContext):
    plan = ctx.variables.get("application_source_plan")
    if plan is not None:
        return plan
    plan = ApplicationSourceManager(ctx.variables.get("command_runner")).resolve(_profile(ctx).application.source)
    ctx.variables["application_source_plan"] = plan
    return plan


class ApplicationHealthGateTask(OperationTask):
    id = "application.health-gate"
    description = "Verify frontend, Edge Runtime/Functions, LiveKit and Coturn as one Application health gate."
    dependencies = ("application.coturn",)
    reverify_on_resume = True

    def _inspect(self, ctx):
        env = _profile(ctx); plan = _source_plan(ctx)
        runner = ctx.variables.get("command_runner")
        provider = ctx.variables.get("application_secret_provider") or FileSecretProvider(env.application.secret_file)
        manifest = load_build_manifest(Path(plan.release_path) / "deploy/spark-cli/spark-build.yaml")
        frontend = StaticHealthGate(runner).wait_healthy(manifest)
        edge_runtime = ctx.variables.get("application_edge_runtime") or EdgeRuntimeManager(runner)
        edge = EdgeVerifier(edge_runtime).inspect(env)
        livekit_runtime = ctx.variables.get("application_livekit_runtime") or LiveKitRuntimeManager(provider, runner)
        livekit = inspect_livekit(livekit_runtime, env.application.livekit)
        coturn_runtime = ctx.variables.get("application_coturn_runtime") or CoturnRuntimeManager(provider, runner)
        coturn_missing = coturn_runtime.missing_requirements(env.application.coturn)
        coturn = None if coturn_missing else inspect_coturn(coturn_runtime, env.application.coturn)
        return frontend, edge, livekit, coturn, coturn_missing

    def detect(self, ctx):
        frontend, edge, livekit, coturn, missing = self._inspect(ctx)
        healthy = frontend and edge.healthy and livekit.healthy and coturn is not None and coturn.healthy
        return TaskResult.success(
            "Application health inspected", healthy=healthy, frontend=frontend, edge=edge.healthy,
            livekit=livekit.healthy, coturn=(coturn.healthy if coturn else False), coturn_missing=list(missing),
        )

    def plan(self, ctx):
        return TaskResult.success("Application health gate is read-only")

    def apply(self, ctx):
        return TaskResult.success("Application health gate performs no mutation", changed=False)

    def verify(self, ctx):
        frontend, edge, livekit, coturn, missing = self._inspect(ctx)
        if missing:
            return TaskResult.failed("WAITING_FOR_OPERATOR: Coturn inputs incomplete", waiting_for_operator=True, missing=list(missing))
        if not (frontend and edge.healthy and livekit.healthy and coturn and coturn.healthy):
            return TaskResult.failed(
                "Application composite health gate failed", frontend=frontend, edge=edge.healthy,
                livekit=livekit.healthy, coturn=(coturn.healthy if coturn else False),
            )
        return TaskResult.success("Application is HEALTHY", frontend=True, edge=True, livekit=True, coturn=True)
