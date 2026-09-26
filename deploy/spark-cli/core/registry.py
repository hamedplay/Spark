from __future__ import annotations

from collections import OrderedDict
from typing import Iterable

from .errors import DuplicateOperationError
from .operation import OperationTask


class OperationRegistry:
    def __init__(self) -> None:
        self._operations: "OrderedDict[str, OperationTask]" = OrderedDict()

    def register(self, operation: OperationTask) -> OperationTask:
        if operation.id in self._operations:
            raise DuplicateOperationError(f"duplicate operation id: {operation.id}")
        self._operations[operation.id] = operation
        return operation

    def get(self, operation_id: str) -> OperationTask:
        return self._operations[operation_id]

    def list(self) -> list[OperationTask]:
        return list(self._operations.values())

    def ids(self) -> list[str]:
        return list(self._operations.keys())

    def extend(self, operations: Iterable[OperationTask]) -> None:
        for operation in operations:
            self.register(operation)

    def __contains__(self, operation_id: object) -> bool:
        return operation_id in self._operations
