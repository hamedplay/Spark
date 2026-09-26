from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Optional


class TaskStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    SUCCESS = "success"
    FAILED = "failed"
    SKIPPED = "skipped"
    ROLLED_BACK = "rolled_back"


@dataclass
class TaskResult:
    status: TaskStatus
    changed: bool = False
    message: str = ""
    details: dict[str, Any] = field(default_factory=dict)
    error: Optional[BaseException] = None

    @property
    def ok(self) -> bool:
        return self.status in {TaskStatus.SUCCESS, TaskStatus.SKIPPED}

    @classmethod
    def success(cls, message: str = "", *, changed: bool = False, **details: Any) -> "TaskResult":
        return cls(TaskStatus.SUCCESS, changed=changed, message=message, details=details)

    @classmethod
    def failed(cls, message: str, error: Optional[BaseException] = None, **details: Any) -> "TaskResult":
        return cls(TaskStatus.FAILED, message=message, details=details, error=error)

    @classmethod
    def skipped(cls, message: str = "") -> "TaskResult":
        return cls(TaskStatus.SKIPPED, message=message)
