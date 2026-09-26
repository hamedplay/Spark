from __future__ import annotations

from dataclasses import dataclass

from .errors import DependencyCycleError, UnknownDependencyError
from .operation import OperationTask
from .registry import OperationRegistry


@dataclass(frozen=True)
class PlannedOperation:
    operation: OperationTask
    order: int


@dataclass(frozen=True)
class ExecutionPlan:
    operations: tuple[PlannedOperation, ...]

    @property
    def ids(self) -> tuple[str, ...]:
        return tuple(item.operation.id for item in self.operations)


class Planner:
    def __init__(self, registry: OperationRegistry) -> None:
        self.registry = registry

    def build(self, targets: list[str] | tuple[str, ...] | None = None) -> ExecutionPlan:
        requested = list(targets or self.registry.ids())
        ordered: list[OperationTask] = []
        permanent: set[str] = set()
        visiting: set[str] = set()

        def visit(operation_id: str) -> None:
            if operation_id in permanent:
                return
            if operation_id in visiting:
                raise DependencyCycleError(f"dependency cycle detected at: {operation_id}")
            if operation_id not in self.registry:
                raise UnknownDependencyError(f"unknown operation dependency: {operation_id}")
            visiting.add(operation_id)
            operation = self.registry.get(operation_id)
            for dependency in operation.dependencies:
                visit(dependency)
            visiting.remove(operation_id)
            permanent.add(operation_id)
            ordered.append(operation)

        for operation_id in requested:
            visit(operation_id)

        return ExecutionPlan(tuple(PlannedOperation(op, index + 1) for index, op in enumerate(ordered)))
