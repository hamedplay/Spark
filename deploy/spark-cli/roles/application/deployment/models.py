from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class DeploymentResult:
    status: str
    candidate: str
    previous: str | None
    production_restored: bool = False
    rollback_status: str | None = None
    changed: bool = False
