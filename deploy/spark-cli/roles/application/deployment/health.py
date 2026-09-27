from __future__ import annotations

import socket
import time
import urllib.error
import urllib.request
from pathlib import Path

from adapters.command import CommandRunner
from roles.application.build.manifest import BuildManifest


class StaticHealthGate:
    def __init__(self, runner: CommandRunner | None = None) -> None:
        self.runner = runner or CommandRunner()

    def artifact_ok(self, current_link: str | Path, document_root: str) -> bool:
        index = Path(current_link) / document_root / "index.html"
        return index.is_file() and index.stat().st_size > 0

    def nginx_active(self) -> bool:
        result = self.runner.run(("systemctl", "is-active", "nginx"), timeout=15)
        return result.returncode == 0 and result.stdout.strip() == "active"

    def tcp_ok(self, host: str, port: int) -> bool:
        try:
            with socket.create_connection((host, port), timeout=3):
                return True
        except OSError:
            return False

    def http_ok(self, manifest: BuildManifest) -> bool:
        url = f"http://{manifest.health_host}:{manifest.health_port}{manifest.health_path}"
        try:
            with urllib.request.urlopen(url, timeout=5) as response:
                if response.status != 200:
                    return False
                content_type = (response.headers.get("Content-Type") or "").lower()
                if "html" not in content_type:
                    return False
                body = response.read(1024 * 1024).decode("utf-8", errors="ignore")
                return not manifest.health_marker or manifest.health_marker in body
        except (urllib.error.URLError, TimeoutError, OSError):
            return False

    def wait_healthy(self, manifest: BuildManifest) -> bool:
        deadline = time.monotonic() + manifest.health_timeout_seconds
        while True:
            if (
                self.artifact_ok(manifest.current_link, manifest.document_root)
                and self.nginx_active()
                and self.tcp_ok(manifest.health_host, manifest.health_port)
                and self.http_ok(manifest)
            ):
                return True
            if time.monotonic() >= deadline:
                return False
            time.sleep(max(1, manifest.health_interval_seconds))
