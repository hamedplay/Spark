from __future__ import annotations

from pathlib import Path

from config.loader import load_environment
from core.context import ExecutionContext
from core.operation import OperationTask
from core.result import TaskResult
from roles.application.build import StaticApplicationBuilder
from roles.application.source import ApplicationSourceManager


class ApplicationBuildTask(OperationTask):
    id = "application.build"
    description = "Create and verify a reproducible static Spark frontend build without activation."
    dependencies = ("application.config",)

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

    def _builder(self, ctx):
        return ctx.variables.get("application_builder") or StaticApplicationBuilder(ctx.variables.get("command_runner"))

    def _manifest(self, plan):
        path = Path(plan.release_path) / "deploy/spark-build.yaml"
        if not path.is_file():
            raise RuntimeError("REFUSED: deploy/spark-build.yaml is missing from pinned release")
        return path

    def detect(self, ctx):
        plan = self._source_plan(ctx)
        result = self._builder(ctx).build(plan.release_path, plan.resolved_commit, self._manifest(plan), build_env=ctx.variables.get("application_build_env"), dry_run=True)
        ctx.variables["application_build_plan"] = result
        return TaskResult.success("application build inspected", **result)

    def plan(self, ctx):
        plan = self._source_plan(ctx)
        result = self._builder(ctx).build(plan.release_path, plan.resolved_commit, self._manifest(plan), build_env=ctx.variables.get("application_build_env"), dry_run=True)
        return TaskResult.success("application build plan", **result)

    def apply(self, ctx):
        plan = self._source_plan(ctx)
        result = self._builder(ctx).build(plan.release_path, plan.resolved_commit, self._manifest(plan), build_env=ctx.variables.get("application_build_env"), dry_run=False)
        return TaskResult.success("application build verified", **result)

    def verify(self, ctx):
        plan = self._source_plan(ctx)
        result = self._builder(ctx).build(plan.release_path, plan.resolved_commit, self._manifest(plan), build_env=ctx.variables.get("application_build_env"), dry_run=True)
        if result.get("status") not in {"VERIFIED", "PLANNED"}:
            return TaskResult.failed("application build verification failed")
        metadata = Path(plan.release_path) / ".spark/build-metadata.json"
        return TaskResult.success("application build verification complete") if metadata.is_file() else TaskResult.failed("application build metadata missing")
