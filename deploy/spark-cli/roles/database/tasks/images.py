from __future__ import annotations

from config.loader import load_environment
from core.context import ExecutionContext
from core.operation import OperationTask
from core.result import TaskResult
from roles.database.lifecycle import DatabaseImageManager
from roles.database.lifecycle.models import ImageReadiness


class DatabaseImagesTask(OperationTask):
    id = "database.images"
    description = "Ensure all OCI images required by the resolved database compose are available."
    dependencies = ("database.compose",)
    reverify_on_resume = True

    def _profile(self, ctx: ExecutionContext):
        path = ctx.variables.get("environment_profile")
        if not path:
            raise ValueError("environment_profile is required")
        return load_environment(path)

    def _manager(self, ctx: ExecutionContext) -> DatabaseImageManager:
        return ctx.variables.get("database_image_manager") or DatabaseImageManager()

    def detect(self, ctx: ExecutionContext) -> TaskResult:
        inventory = self._manager(ctx).inventory(self._profile(ctx))
        return TaskResult.success(
            "database image inventory inspected",
            images=tuple({"service": item.service, "reference": item.reference, "present": item.present} for item in inventory),
        )

    def plan(self, ctx: ExecutionContext) -> TaskResult:
        plan = self._manager(ctx).plan(self._profile(ctx))
        if plan["blocked"]:
            return TaskResult.failed("database image plan blocked", blocked=plan["blocked"], missing_services=plan["missing_services"])
        return TaskResult.success("database image plan", missing_services=plan["missing_services"], status=plan["status"])

    def apply(self, ctx: ExecutionContext) -> TaskResult:
        changed = self._manager(ctx).acquire(self._profile(ctx))
        return TaskResult.success("database images ready", changed=changed)

    def verify(self, ctx: ExecutionContext) -> TaskResult:
        status = self._manager(ctx).status(self._profile(ctx))
        if status != ImageReadiness.READY:
            return TaskResult.failed("database image verification failed", status=status.value)
        return TaskResult.success("database images verified", status=status.value)
