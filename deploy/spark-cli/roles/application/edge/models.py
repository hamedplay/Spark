from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class EdgeFunctionIdentity:
    name: str
    sha256: str


@dataclass(frozen=True)
class EdgeDeploymentIdentity:
    source_sha: str
    source_sha256: str
    runtime_image: str
    functions: tuple[EdgeFunctionIdentity, ...]


@dataclass(frozen=True)
class EdgeHealth:
    runtime_running: bool
    functions_present: bool
    supabase_reachable: bool
    probe_status: int | None

    @property
    def healthy(self) -> bool:
        return self.runtime_running and self.functions_present and self.supabase_reachable and self.probe_status in {200, 401, 403}
