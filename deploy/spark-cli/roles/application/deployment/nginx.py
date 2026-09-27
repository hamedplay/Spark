from __future__ import annotations

from adapters.command import CommandRunner


class NginxManager:
    def __init__(self, runner: CommandRunner | None = None) -> None:
        self.runner = runner or CommandRunner()

    def config_valid(self) -> bool:
        return self.runner.run(("nginx", "-t"), timeout=30).returncode == 0

    def active(self) -> bool:
        result = self.runner.run(("systemctl", "is-active", "nginx"), timeout=15)
        return result.returncode == 0 and result.stdout.strip() == "active"

    def reload(self) -> None:
        if not self.config_valid():
            raise RuntimeError("REFUSED: nginx configuration validation failed")
        result = self.runner.run(("systemctl", "reload", "nginx"), timeout=30)
        if result.returncode != 0:
            raise RuntimeError("nginx reload failed")
