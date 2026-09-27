from __future__ import annotations

from pathlib import Path

from config.loader import load_environment
from core.context import ExecutionContext
from core.operation import OperationTask
from core.result import TaskResult
from roles.application.edge import EdgeDeploymentController, EdgeRuntimeManager, EdgeVerifier
from roles.application.source import ApplicationSourceManager


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


class ApplicationEdgeRuntimeTask(OperationTask):
    id = "application.edge-runtime"
    description = "Prepare and run pinned Supabase Edge Runtime on the Application node."
    dependencies = ("application.deploy",)
    reverify_on_resume = True

    def _runtime(self, ctx):
        return ctx.variables.get("application_edge_runtime") or EdgeRuntimeManager(ctx.variables.get("command_runner"))

    def detect(self, ctx):
        env = _profile(ctx)
        running = self._runtime(ctx).running(env.application.edge)
        return TaskResult.success("Edge Runtime inspected", running=running, image=env.application.edge.image)

    def plan(self, ctx):
        env = _profile(ctx); plan = _source_plan(ctx)
        identity = self._runtime(ctx).identity(plan.release_path, plan.resolved_commit, env.application.edge)
        return TaskResult.success(
            "Edge Runtime deployment plan",
            source_sha=identity.source_sha,
            source_sha256=identity.source_sha256,
            image=identity.runtime_image,
            port=env.application.edge.port,
            function_count=len(identity.functions),
        )

    def apply(self, ctx):
        env = _profile(ctx); plan = _source_plan(ctx)
        identity, changed = self._runtime(ctx).prepare(plan.release_path, plan.resolved_commit, env.application.edge)
        self._runtime(ctx).start(env.application.edge)
        ctx.variables["application_edge_identity"] = identity
        return TaskResult.success("Edge Runtime deployed", changed=changed, image=identity.runtime_image)

    def verify(self, ctx):
        env = _profile(ctx)
        health = EdgeVerifier(self._runtime(ctx)).inspect(env)
        return TaskResult.success("Edge Runtime verified", probe_status=health.probe_status) if health.healthy else TaskResult.failed(
            "Edge Runtime health gate failed", runtime=health.runtime_running, functions=health.functions_present,
            supabase=health.supabase_reachable, probe_status=health.probe_status,
        )


class ApplicationEdgeFunctionsTask(OperationTask):
    id = "application.edge-functions"
    description = "Verify Spark Edge Function inventory and safe invocation path."
    dependencies = ("application.edge-runtime",)
    reverify_on_resume = True

    def _runtime(self, ctx):
        return ctx.variables.get("application_edge_runtime") or EdgeRuntimeManager(ctx.variables.get("command_runner"))

    def detect(self, ctx):
        env = _profile(ctx); plan = _source_plan(ctx)
        identity = self._runtime(ctx).identity(plan.release_path, plan.resolved_commit, env.application.edge)
        deployed = Path(env.application.edge.root) / "edge-metadata.json"
        return TaskResult.success("Edge Functions inspected", function_count=len(identity.functions), metadata_present=deployed.is_file())

    def plan(self, ctx):
        env = _profile(ctx); plan = _source_plan(ctx)
        identity = self._runtime(ctx).identity(plan.release_path, plan.resolved_commit, env.application.edge)
        return TaskResult.success("Edge Functions verification plan", functions=[item.name for item in identity.functions], probe_function=env.application.edge.probe_function)

    def apply(self, ctx):
        return TaskResult.success("Edge Functions are deployed with the immutable Edge Runtime payload", changed=False)

    def verify(self, ctx):
        env = _profile(ctx)
        health = EdgeVerifier(self._runtime(ctx)).inspect(env)
        if not health.healthy:
            return TaskResult.failed("Edge Functions verification failed", probe_status=health.probe_status)
        return TaskResult.success("Edge Functions verified", probe_status=health.probe_status)
