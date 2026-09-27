from __future__ import annotations

import json
import os
from pathlib import Path

from roles.application.build.manifest import BuildManifest
from .health import StaticHealthGate
from .lock import DeploymentLock
from .models import DeploymentResult
from .nginx import NginxManager


class StaticApplicationActivator:
    def __init__(self, *, health: StaticHealthGate | None = None, nginx: NginxManager | None = None, lock_path: str | Path = "/run/lock/spark-application-deploy.lock", state_path: str | Path = "/var/lib/spark-manager/application-deployment.json") -> None:
        self.health = health or StaticHealthGate()
        self.nginx = nginx or NginxManager()
        self.lock_path = Path(lock_path)
        self.state_path = Path(state_path)

    @staticmethod
    def _target(link: Path) -> str | None:
        if not link.is_symlink():
            return None
        try:
            return str(link.resolve(strict=False))
        except OSError:
            return None

    @staticmethod
    def _atomic_link(link: Path, target: Path) -> None:
        link.parent.mkdir(parents=True, exist_ok=True)
        temp = link.parent / f".{link.name}.next.{os.getpid()}"
        try:
            if temp.exists() or temp.is_symlink():
                temp.unlink()
            os.symlink(str(target), str(temp))
            os.replace(temp, link)
        finally:
            if temp.exists() or temp.is_symlink():
                temp.unlink()

    def _write_state(self, payload: dict) -> None:
        self.state_path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.state_path.with_suffix(".tmp")
        tmp.write_text(json.dumps(payload, sort_keys=True, separators=(",", ":")))
        os.replace(tmp, self.state_path)

    def _clear_state(self) -> None:
        try:
            self.state_path.unlink()
        except FileNotFoundError:
            pass

    def _rollback(self, link: Path, previous: str | None, manifest: BuildManifest) -> tuple[str, bool]:
        if previous is None:
            if link.is_symlink() or link.exists():
                link.unlink()
            return "NO_PREVIOUS_RELEASE", False
        self._atomic_link(link, Path(previous))
        healthy = self.health.wait_healthy(manifest)
        return ("SUCCESS" if healthy else "FAILED", healthy)

    def deploy(self, release: str | Path, manifest: BuildManifest, *, dry_run: bool = False, reload_nginx: bool = False) -> DeploymentResult:
        release = Path(release).resolve()
        metadata = release / ".spark/build-metadata.json"
        if not metadata.is_file():
            raise RuntimeError("REFUSED: candidate release has no verified build metadata")
        try:
            if json.loads(metadata.read_text()).get("status") != "VERIFIED":
                raise RuntimeError("REFUSED: candidate release build is not VERIFIED")
        except (OSError, ValueError) as exc:
            raise RuntimeError("REFUSED: invalid candidate build metadata") from exc
        link = Path(manifest.current_link)
        previous = self._target(link)
        if previous == str(release) and self.health.wait_healthy(manifest):
            return DeploymentResult("ALREADY_ACTIVE", release.name, previous, changed=False)
        if dry_run:
            return DeploymentResult("PLANNED", release.name, previous, changed=False)
        with DeploymentLock(self.lock_path):
            if reload_nginx and not self.nginx.config_valid():
                raise RuntimeError("REFUSED: nginx configuration validation failed")
            self._write_state({"candidate": str(release), "previous": previous, "activation_started": True})
            self._atomic_link(link, release)
            if reload_nginx:
                self.nginx.reload()
            if self.health.wait_healthy(manifest):
                self._clear_state()
                return DeploymentResult("DEPLOYED", release.name, previous, changed=True)
            rollback_status, restored = self._rollback(link, previous, manifest)
            self._clear_state()
            if previous is None:
                return DeploymentResult("FIRST_DEPLOYMENT_FAILED", release.name, None, False, rollback_status, True)
            if restored:
                return DeploymentResult("DEPLOYMENT_FAILED", release.name, previous, True, "SUCCESS", True)
            return DeploymentResult("CRITICAL_DEPLOYMENT_FAILURE", release.name, previous, False, "FAILED", True)

    def resume(self, manifest: BuildManifest) -> DeploymentResult | None:
        if not self.state_path.is_file():
            return None
        state = json.loads(self.state_path.read_text())
        candidate = str(state["candidate"])
        previous = state.get("previous")
        link = Path(manifest.current_link)
        current = self._target(link)
        with DeploymentLock(self.lock_path):
            if current == candidate and self.health.wait_healthy(manifest):
                self._clear_state()
                return DeploymentResult("DEPLOYED", Path(candidate).name, previous, changed=False)
            if current == previous:
                restored = previous is not None and self.health.wait_healthy(manifest)
                self._clear_state()
                return DeploymentResult("DEPLOYMENT_FAILED", Path(candidate).name, previous, restored, "SUCCESS" if restored else "FAILED", changed=False)
            rollback_status, restored = self._rollback(link, previous, manifest)
            self._clear_state()
            return DeploymentResult("DEPLOYMENT_FAILED" if restored else "CRITICAL_DEPLOYMENT_FAILURE", Path(candidate).name, previous, restored, rollback_status, changed=False)
