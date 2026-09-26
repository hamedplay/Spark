from __future__ import annotations
from pathlib import Path
from .command import CommandRunner

class DockerAdapter:
    def __init__(self, runner: CommandRunner | None = None) -> None:
        self.runner = runner or CommandRunner()
    def engine_version(self) -> str | None:
        result = self.runner.run(("docker", "version", "--format", "{{.Client.Version}}"))
        return result.stdout.strip() or None if result.returncode == 0 else None
    def daemon_healthy(self) -> bool:
        return self.runner.run(("docker", "info", "--format", "{{.ServerVersion}}" )).returncode == 0
    def compose_version(self) -> str | None:
        result = self.runner.run(("docker", "compose", "version", "--short"))
        return result.stdout.strip() or None if result.returncode == 0 else None
    def compose_config(self, project_dir: Path, env_file: Path) -> str:
        result = self.runner.run(("docker", "compose", "--env-file", str(env_file), "-f", str(project_dir / "docker-compose.yml"), "config"))
        if result.returncode != 0:
            raise RuntimeError("docker compose config failed")
        return result.stdout
    def compose_services(self, project_dir: Path, env_file: Path) -> tuple[str, ...]:
        result = self.runner.run(("docker", "compose", "--env-file", str(env_file), "-f", str(project_dir / "docker-compose.yml"), "config", "--services"))
        if result.returncode != 0:
            raise RuntimeError("docker compose service inventory failed")
        return tuple(line.strip() for line in result.stdout.splitlines() if line.strip())
