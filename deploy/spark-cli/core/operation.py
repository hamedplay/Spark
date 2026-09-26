from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Sequence

from .context import ExecutionContext
from .result import TaskResult
from .retry import RetryPolicy


class OperationTask(ABC):
    id: str = ""
    description: str = ""
    dependencies: Sequence[str] = ()
    retry_policy: RetryPolicy = RetryPolicy()
    supports_rollback: bool = False
    reverify_on_resume: bool = False

    def __init_subclass__(cls, **kwargs):
        super().__init_subclass__(**kwargs)
        if cls is not OperationTask and not getattr(cls, "id", ""):
            raise TypeError(f"{cls.__name__} must define a non-empty id")

    def retry_policy_for(self, ctx: ExecutionContext) -> RetryPolicy:
        return self.retry_policy

    @abstractmethod
    def detect(self, ctx: ExecutionContext) -> TaskResult:
        raise NotImplementedError

    @abstractmethod
    def plan(self, ctx: ExecutionContext) -> TaskResult:
        raise NotImplementedError

    @abstractmethod
    def apply(self, ctx: ExecutionContext) -> TaskResult:
        raise NotImplementedError

    @abstractmethod
    def verify(self, ctx: ExecutionContext) -> TaskResult:
        raise NotImplementedError

    def rollback(self, ctx: ExecutionContext) -> TaskResult:
        return TaskResult.skipped("rollback is not supported")
