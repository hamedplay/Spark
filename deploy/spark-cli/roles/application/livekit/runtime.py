from __future__ import annotations

import hashlib
import json
import os
import shutil
from pathlib import Path

from adapters.command import CommandRunner
from config.models import ApplicationLiveKitConfig
from secrets.provider import SecretProvider

from .config import LiveKitConfigRenderer


class LiveKitRuntimeManager:
    def __init__(self, secrets: SecretProvider, runner: CommandRunner | None = None) -> None:
        self.secrets = secrets
        self.runner = runner or CommandRunner()
        self.renderer = LiveKitConfigRenderer(secrets)

    @staticmethod
    def _tree_hash(root: Path) -> str:
        digest = hashlib.sha256()
        for path in sorted(p for p in root.rglob("*") if p.is_file()):
            digest.update(path.relative_to(root).as_posix().encode())
            digest.update(b"\0")
            digest.update(hashlib.sha256(path.read_bytes()).digest())
        return digest.hexdigest()

    @staticmethod
    def _compose(config: ApplicationLiveKitConfig) -> str:
        return f'''services:\n  redis:\n    image: {config.redis_image}\n    container_name: spark-livekit-redis\n    restart: unless-stopped\n    ports:\n      - "127.0.0.1:6379:6379"\n  livekit:\n    image: {config.image}\n    container_name: spark-livekit\n    restart: unless-stopped\n    network_mode: host\n    depends_on:\n      - redis\n    volumes:\n      - ./livekit.yaml:/etc/livekit.yaml:ro\n    command: ["--config", "/etc/livekit.yaml"]\n'''

    def missing_secrets(self) -> tuple[str, ...]:
        return self.renderer.missing_secrets()

    def prepare(self, release: str | Path, source_sha: str, config: ApplicationLiveKitConfig, *, dry_run: bool = False) -> bool:
        release = Path(release)
        source = release / config.source_dir
        if not source.is_dir():
            raise RuntimeError("LiveKit deployment package is missing from release")
        identity = {
            "source_sha": source_sha,
            "package_sha256": self._tree_hash(source),
            "livekit_image": config.image,
            "redis_image": config.redis_image,
            "embedded_turn": config.embedded_turn,
        }
        root = Path(config.root)
        metadata = root / "metadata.json"
        expected = json.dumps(identity, sort_keys=True, indent=2) + "\n"
        if metadata.is_file() and metadata.read_text() == expected and (root / "docker-compose.yml").is_file() and (root / "livekit.yaml").is_file():
            return False
        if dry_run:
            return True
        root.mkdir(parents=True, exist_ok=True)
        package = root / "package"
        staged = root / "package.new"
        if staged.exists():
            shutil.rmtree(staged)
        shutil.copytree(source, staged)
        if package.exists():
            shutil.rmtree(package)
        os.replace(staged, package)
        self.renderer.atomic_write(root / "livekit.yaml", self.renderer.render(config), 0o600)
        self.renderer.atomic_write(root / "docker-compose.yml", self._compose(config), 0o600)
        self.renderer.atomic_write(metadata, expected, 0o600)
        return True

    def start(self, config: ApplicationLiveKitConfig) -> None:
        root = Path(config.root)
        result = self.runner.run(("docker", "compose", "-p", "spark-livekit", "-f", str(root / "docker-compose.yml"), "up", "-d", "redis", "livekit"), timeout=300)
        if result.returncode != 0:
            raise RuntimeError("LiveKit runtime start failed")

    def container_running(self, name: str) -> bool:
        result = self.runner.run(("docker", "inspect", "-f", "{{.State.Running}}", name), timeout=15)
        return result.returncode == 0 and result.stdout.strip().lower() == "true"
