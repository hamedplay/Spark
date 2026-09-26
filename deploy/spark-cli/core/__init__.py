"""Workflow foundation for Spark Server Manager.

Phase 1 is intentionally side-by-side with the legacy production runtime.
"""

from .context import ExecutionContext
from .operation import OperationTask
from .registry import OperationRegistry
from .result import TaskResult, TaskStatus
from .workflow import Workflow, WorkflowResult

__all__ = [
    "ExecutionContext",
    "OperationRegistry",
    "OperationTask",
    "TaskResult",
    "TaskStatus",
    "Workflow",
    "WorkflowResult",
]
