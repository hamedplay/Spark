from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional

from .state import StateStore


@dataclass
class ExecutionContext:
    environment: str = "production"
    mode: str = "online"
    dry_run: bool = False
    resume: bool = False
    variables: dict[str, Any] = field(default_factory=dict)
    state: Optional[StateStore] = None
    execution_id: Optional[str] = None
