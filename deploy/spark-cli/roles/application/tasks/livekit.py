from __future__ import annotations

from config.loader import load_environment
from core.context import ExecutionContext
from core.operation import OperationTask
from core.result import TaskResult
from roles.application.livekit import LiveKitRuntimeManager, inspect_livekit, livekit_network_requirements
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


class ApplicationLiveKitTask(OperationTask):
    id = "application.livekit"
    description = "Provision pinned LiveKit + Redis on the Application node with embedded TURN disabled."
    dependencies = ("application.edge-functions",)
    reverify_on_resume = True

    def _runtime(self, ctx):
        env = _profile(ctx)
        provider = ctx.variables.get("application_secret_provider") or FileSecretProvider(env.application.secret_file)
        return ctx.variables.get("application_livekit_runtime") or LiveKitRuntimeManager(provider, ctx.variables.get("command_runner"))

    def detect(self, ctx):
        env = _profile(ctx); runtime = self._runtime(ctx)
        health = inspect_livekit(runtime, env.application.livekit)
        return TaskResult.success("LiveKit inspected", healthy=health.healthy, livekit=health.livekit_running, redis=health.redis_running)

    def plan(self, ctx):
        env = _profile(ctx); runtime = self._runtime(ctx); plan = _source_plan(ctx)
        missing = runtime.missing_secrets()
        if missing:
            return TaskResult.failed("WAITING_FOR_OPERATOR: required LiveKit secrets are missing", waiting_for_operator=True, missing=list(missing))
        return TaskResult.success(
            "LiveKit provision plan",
            source_sha=plan.resolved_commit,
            image=env.application.livekit.image,
            redis_image=env.application.livekit.redis_image,
            embedded_turn=False,
            network=list(livekit_network_requirements(env.application.livekit)),
        )

    def apply(self, ctx):
        env = _profile(ctx); runtime = self._runtime(ctx); plan = _source_plan(ctx)
        changed = runtime.prepare(plan.release_path, plan.resolved_commit, env.application.livekit)
        runtime.start(env.application.livekit)
        return TaskResult.success("LiveKit provisioned", changed=changed)

    def verify(self, ctx):
        env = _profile(ctx); health = inspect_livekit(self._runtime(ctx), env.application.livekit)
        if not health.healthy:
            return TaskResult.failed(
                "LiveKit health gate failed", redis=health.redis_running, livekit=health.livekit_running,
                api=health.api_reachable, rtc_tcp=health.rtc_tcp_reachable, embedded_turn_disabled=health.embedded_turn_disabled,
            )
        return TaskResult.success("LiveKit verified", api_port=env.application.livekit.api_port, rtc_tcp_port=env.application.livekit.rtc_tcp_port)
