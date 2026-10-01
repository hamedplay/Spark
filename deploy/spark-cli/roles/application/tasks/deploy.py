from __future__ import annotations

import json
from pathlib import Path

from config.loader import load_environment
from core.context import ExecutionContext
from core.operation import OperationTask
from core.result import TaskResult
from roles.application.build.manifest import load_build_manifest
from roles.application.deployment import StaticApplicationActivator
from roles.application.source import ApplicationSourceManager


class ApplicationDeployTask(OperationTask):
    id = "application.deploy"
    description = "Atomically activate a verified static Spark release and roll back on health failure."
    dependencies = ("application.build",)
    reverify_on_resume = True

    def _profile(self, ctx):
        path = ctx.variables.get("environment_profile")
        if not path:
            raise ValueError("environment_profile is required")
        return load_environment(path)

    def _source_plan(self, ctx):
        plan = ctx.variables.get("application_source_plan")
        if plan is not None:
            return plan
        return ApplicationSourceManager(ctx.variables.get("command_runner")).resolve(self._profile(ctx).application.source)

    def _manifest(self, plan):
        return load_build_manifest(Path(plan.release_path) / "deploy/spark-cli/spark-build.yaml")

    def _activator(self, ctx):
        return ctx.variables.get("application_activator") or StaticApplicationActivator()

    def detect(self, ctx):
        plan = self._source_plan(ctx)
        manifest = self._manifest(plan)
        current = Path(manifest.current_link)
        target = str(current.resolve(strict=False)) if current.is_symlink() else None
        activator = self._activator(ctx)
        recovery = None
        if activator.state_path.is_file():
            try:
                state = json.loads(activator.state_path.read_text())
                recovery = {
                    "candidate": state.get("candidate"),
                    "previous": state.get("previous"),
                    "activation_started": bool(state.get("activation_started")),
                }
            except (OSError, ValueError):
                recovery = {"invalid_state": True}
        ctx.variables["application_deploy_recovery"] = recovery
        return TaskResult.success("application deployment inspected", current=target, candidate=plan.release_path, recovery=recovery)

    def plan(self, ctx):
        plan = self._source_plan(ctx)
        manifest = self._manifest(plan)
        current = Path(manifest.current_link)
        previous = str(current.resolve(strict=False)) if current.is_symlink() else None
        return TaskResult.success(
            "application deployment plan",
            candidate=plan.release_path,
            previous=previous,
            current_link=manifest.current_link,
            document_root=manifest.document_root,
            health_url=f"http://{manifest.health_host}:{manifest.health_port}{manifest.health_path}",
            nginx_reload=bool(ctx.variables.get("application_reload_nginx", False)),
            recovery=ctx.variables.get("application_deploy_recovery"),
        )

    def apply(self, ctx):
        plan = self._source_plan(ctx)
        manifest = self._manifest(plan)
        activator = self._activator(ctx)
        if activator.state_path.is_file():
            resumed = activator.resume(manifest)
            if resumed is not None:
                ctx.variables["application_deploy_result"] = resumed
                if resumed.status in {"DEPLOYED", "ALREADY_ACTIVE"}:
                    return TaskResult.success("application deployment resumed", changed=resumed.changed, status=resumed.status)
                return TaskResult.failed(
                    "application deployment resume required rollback",
                    status=resumed.status,
                    rollback_status=resumed.rollback_status,
                    production_restored=resumed.production_restored,
                )
        result = activator.deploy(
            plan.release_path,
            manifest,
            dry_run=False,
            reload_nginx=bool(ctx.variables.get("application_reload_nginx", False)),
        )
        ctx.variables["application_deploy_result"] = result
        if result.status in {"DEPLOYED", "ALREADY_ACTIVE"}:
            return TaskResult.success("application static release activated", changed=result.changed, status=result.status)
        return TaskResult.failed("application deployment failed", status=result.status, rollback_status=result.rollback_status, production_restored=result.production_restored)

    def verify(self, ctx):
        plan = self._source_plan(ctx)
        manifest = self._manifest(plan)
        current = Path(manifest.current_link)
        if not current.is_symlink() or current.resolve(strict=False) != Path(plan.release_path).resolve():
            return TaskResult.failed("application candidate is not active")
        if not self._activator(ctx).health.wait_healthy(manifest):
            return TaskResult.failed("application static frontend health gate failed")
        return TaskResult.success("application static frontend verified", release=plan.resolved_commit)
