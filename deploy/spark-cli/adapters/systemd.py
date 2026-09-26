from __future__ import annotations
from .command import CommandRunner

class SystemdAdapter:
    def __init__(self, runner: CommandRunner | None = None) -> None:
        self.runner = runner or CommandRunner()
    def is_active(self, unit: str) -> bool:
        return self.runner.run(("systemctl", "is-active", "--quiet", unit)).returncode == 0
    def is_enabled(self, unit: str) -> bool:
        return self.runner.run(("systemctl", "is-enabled", "--quiet", unit)).returncode == 0
    def enable_and_start(self, unit: str) -> None:
        self.runner.run(("systemctl", "enable", "--now", unit), check=True)
