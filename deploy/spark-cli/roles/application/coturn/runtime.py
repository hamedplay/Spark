from __future__ import annotations

import shutil
from pathlib import Path

from adapters.command import CommandRunner
from adapters.systemd import SystemdAdapter
from config.models import ApplicationCoturnConfig
from secrets.provider import SecretProvider

from .config import CoturnConfigRenderer


class CoturnRuntimeManager:
    def __init__(self, secrets: SecretProvider, runner: CommandRunner | None = None) -> None:
        self.secrets = secrets
        self.runner = runner or CommandRunner()
        self.systemd = SystemdAdapter(self.runner)
        self.renderer = CoturnConfigRenderer(secrets)

    def missing_requirements(self, config: ApplicationCoturnConfig) -> tuple[str, ...]:
        return self.renderer.missing_requirements(config)

    def installed(self) -> bool:
        return shutil.which("turnserver") is not None

    def install(self, *, dry_run: bool = False) -> bool:
        if self.installed():
            return False
        if dry_run:
            return True
        update = self.runner.run(("apt-get", "update"), timeout=600)
        if update.returncode != 0:
            raise RuntimeError("Coturn package index refresh failed")
        install = self.runner.run(("apt-get", "install", "-y", "coturn"), timeout=900)
        if install.returncode != 0 or not self.installed():
            raise RuntimeError("Coturn installation failed")
        return True

    def configure(self, config: ApplicationCoturnConfig, *, dry_run: bool = False) -> bool:
        content = self.renderer.render(config)
        target = Path("/etc/turnserver.conf")
        if target.is_file() and target.read_text() == content:
            return False
        if dry_run:
            return True
        self.renderer.atomic_write(target, content)
        return True

    def start(self, config: ApplicationCoturnConfig) -> None:
        result = self.runner.run(("systemctl", "enable", "--now", config.service_name), timeout=120)
        if result.returncode != 0:
            raise RuntimeError("Coturn service start failed")
        restart = self.runner.run(("systemctl", "restart", config.service_name), timeout=120)
        if restart.returncode != 0:
            raise RuntimeError("Coturn service restart failed")

    def active(self, config: ApplicationCoturnConfig) -> bool:
        return self.systemd.is_active(config.service_name)
