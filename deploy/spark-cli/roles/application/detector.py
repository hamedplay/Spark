from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from pathlib import Path


class ComponentState(str, Enum):
    ABSENT = "ABSENT"
    PRESENT = "PRESENT"
    HEALTHY = "HEALTHY"
    UNHEALTHY = "UNHEALTHY"
    UNKNOWN = "UNKNOWN"


@dataclass(frozen=True)
class ApplicationInstallationState:
    source: ComponentState
    runtime_config: ComponentState
    current_release: str | None


def detect_application_installation(
    releases_root: str | Path = "/opt/spark/application/releases",
    current_link: str | Path = "/opt/spark/application/current",
    runtime_env_file: str | Path = "/opt/spark/application/shared/runtime.env",
) -> ApplicationInstallationState:
    releases = Path(releases_root)
    current = Path(current_link)
    env_file = Path(runtime_env_file)
    source_state = ComponentState.PRESENT if releases.exists() and any(releases.iterdir()) else ComponentState.ABSENT
    config_state = ComponentState.PRESENT if env_file.is_file() else ComponentState.ABSENT
    current_release = None
    if current.is_symlink():
        try:
            current_release = str(current.resolve(strict=True))
        except OSError:
            current_release = None
    return ApplicationInstallationState(source_state, config_state, current_release)
