from __future__ import annotations

import time
from dataclasses import dataclass, field

from .context import ExecutionContext
from .planner import ExecutionPlan, Planner
from .registry import OperationRegistry
from .result import TaskResult, TaskStatus


@dataclass
class WorkflowResult:
    workflow_id: str
    status: TaskStatus
    results: dict[str, TaskResult] = field(default_factory=dict)

    @property
    def ok(self) -> bool:
        return self.status == TaskStatus.SUCCESS


class Workflow:
    def __init__(self, workflow_id: str, registry: OperationRegistry, targets: list[str] | None = None) -> None:
        self.id = workflow_id
        self.registry = registry
        self.targets = targets

    def plan(self) -> ExecutionPlan:
        return Planner(self.registry).build(self.targets)

    def execute(self, ctx: ExecutionContext) -> WorkflowResult:
        plan = self.plan()
        results: dict[str, TaskResult] = {}
        saved = ctx.state.load(self.id) if ctx.resume and ctx.state else {"tasks": {}}

        for item in plan.operations:
            operation = item.operation
            dependency_failure = next(
                (dep for dep in operation.dependencies if dep in results and not results[dep].ok),
                None,
            )
            if dependency_failure:
                result = TaskResult.skipped(f"dependency failed: {dependency_failure}")
                results[operation.id] = result
                self._record(ctx, operation.id, result, verified=False)
                continue

            previous = saved.get("tasks", {}).get(operation.id, {})
            if ctx.resume and previous.get("status") == TaskStatus.SUCCESS.value and previous.get("verified"):
                result = TaskResult.skipped("already completed and verified")
                results[operation.id] = result
                continue

            detected = self._safe_call(operation.detect, ctx, "detect")
            if detected.status == TaskStatus.FAILED:
                results[operation.id] = detected
                self._record(ctx, operation.id, detected, verified=False)
                continue

            planned = self._safe_call(operation.plan, ctx, "plan")
            if planned.status == TaskStatus.FAILED:
                results[operation.id] = planned
                self._record(ctx, operation.id, planned, verified=False)
                continue

            if ctx.dry_run:
                result = TaskResult.success("dry-run: apply skipped", changed=False, plan=planned.details)
                results[operation.id] = result
                continue

            applied = self._apply_with_retry(operation, ctx)
            if applied.status == TaskStatus.FAILED:
                results[operation.id] = applied
                self._record(ctx, operation.id, applied, verified=False)
                continue

            verified = self._safe_call(operation.verify, ctx, "verify")
            results[operation.id] = verified
            self._record(ctx, operation.id, verified, verified=verified.status == TaskStatus.SUCCESS)

        final = TaskStatus.SUCCESS if all(result.ok for result in results.values()) else TaskStatus.FAILED
        return WorkflowResult(self.id, final, results)

    def _apply_with_retry(self, operation, ctx: ExecutionContext) -> TaskResult:
        policy = operation.retry_policy
        last = TaskResult.failed("operation was not attempted")
        for attempt in range(1, policy.attempts + 1):
            last = self._safe_call(operation.apply, ctx, "apply")
            if last.status != TaskStatus.FAILED:
                return last
            if attempt < policy.attempts and policy.delay_seconds:
                time.sleep(policy.delay_seconds)
        return last

    @staticmethod
    def _safe_call(func, ctx: ExecutionContext, stage: str) -> TaskResult:
        try:
            result = func(ctx)
        except Exception as exc:  # workflow boundary intentionally contains task failures
            return TaskResult.failed(f"{stage} raised {type(exc).__name__}: {exc}", exc)
        if not isinstance(result, TaskResult):
            return TaskResult.failed(f"{stage} returned invalid result type: {type(result).__name__}")
        return result

    def _record(self, ctx: ExecutionContext, task_id: str, result: TaskResult, *, verified: bool) -> None:
        if ctx.state:
            ctx.state.record_task(self.id, task_id, result.status.value, verified=verified, message=result.message)
