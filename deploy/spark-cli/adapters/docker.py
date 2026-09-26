from __future__ import annotations

import json
from pathlib import Path

from .command import CommandResult, CommandRunner


class DockerAdapter:
    def __init__(self, runner: CommandRunner | None = None) -> None:
        self.runner = runner or CommandRunner()

    def engine_version(self) -> str | None:
        result = self.runner.run(("docker", "version", "--format", "{{.Client.Version}}"))
        return (result.stdout.strip() or None) if result.returncode == 0 else None

    def daemon_healthy(self) -> bool:
        return self.runner.run(("docker", "info", "--format", "{{.ServerVersion}}" )).returncode == 0

    def compose_version(self) -> str | None:
        result = self.runner.run(("docker", "compose", "version", "--short"))
        return (result.stdout.strip() or None) if result.returncode == 0 else None

    @staticmethod
    def _compose_prefix(project_dir: Path, env_file: Path, project_name: str) -> tuple[str, ...]:
        return (
            "docker", "compose",
            "--project-name", project_name,
            "--env-file", str(env_file),
            "-f", str(project_dir / "docker-compose.yml"),
        )

    def compose_config(self, project_dir: Path, env_file: Path, project_name: str = "spark-supabase") -> str:
        result = self.runner.run((*self._compose_prefix(project_dir, env_file, project_name), "config"))
        if result.returncode != 0:
            raise RuntimeError("docker compose config failed")
        return result.stdout

    def compose_config_json(self, project_dir: Path, env_file: Path, project_name: str = "spark-supabase") -> dict:
        result = self.runner.run((*self._compose_prefix(project_dir, env_file, project_name), "config", "--format", "json"))
        if result.returncode != 0:
            raise RuntimeError("docker compose JSON config failed")
        try:
            data = json.loads(result.stdout)
        except json.JSONDecodeError as exc:
            raise RuntimeError("docker compose returned invalid JSON config") from exc
        if not isinstance(data, dict):
            raise RuntimeError("docker compose JSON config must be an object")
        return data

    def compose_services(self, project_dir: Path, env_file: Path, project_name: str = "spark-supabase") -> tuple[str, ...]:
        result = self.runner.run((*self._compose_prefix(project_dir, env_file, project_name), "config", "--services"))
        if result.returncode != 0:
            raise RuntimeError("docker compose service inventory failed")
        return tuple(line.strip() for line in result.stdout.splitlines() if line.strip())

    def compose_service_images(self, project_dir: Path, env_file: Path, project_name: str = "spark-supabase") -> dict[str, str]:
        data = self.compose_config_json(project_dir, env_file, project_name)
        services = data.get("services", {})
        if not isinstance(services, dict):
            raise RuntimeError("docker compose services mapping is invalid")
        result: dict[str, str] = {}
        for name, spec in services.items():
            if isinstance(spec, dict) and spec.get("image"):
                result[str(name)] = str(spec["image"])
        return result

    def image_id(self, reference: str) -> str | None:
        result = self.runner.run(("docker", "image", "inspect", "--format", "{{.Id}}", reference))
        return (result.stdout.strip() or None) if result.returncode == 0 else None

    def compose_pull(
        self,
        project_dir: Path,
        env_file: Path,
        services: tuple[str, ...],
        *,
        project_name: str = "spark-supabase",
        timeout: int = 900,
    ) -> CommandResult:
        if not services:
            return CommandResult(0, "", "")
        return self.runner.run(
            (*self._compose_prefix(project_dir, env_file, project_name), "pull", *services),
            timeout=timeout,
        )

    def compose_up(
        self,
        project_dir: Path,
        env_file: Path,
        services: tuple[str, ...],
        *,
        project_name: str = "spark-supabase",
        wait: bool = False,
        timeout: int = 300,
    ) -> CommandResult:
        args = [*self._compose_prefix(project_dir, env_file, project_name), "up", "-d"]
        if wait:
            args.extend(("--wait", "--wait-timeout", str(timeout)))
        args.extend(services)
        return self.runner.run(tuple(args), timeout=timeout + 30)

    def compose_stop(
        self,
        project_dir: Path,
        env_file: Path,
        services: tuple[str, ...] = (),
        *,
        project_name: str = "spark-supabase",
        timeout: int = 120,
    ) -> CommandResult:
        return self.runner.run(
            (*self._compose_prefix(project_dir, env_file, project_name), "stop", *services),
            timeout=timeout,
        )

    def service_container_id(
        self,
        project_dir: Path,
        env_file: Path,
        service: str,
        project_name: str = "spark-supabase",
    ) -> str | None:
        result = self.runner.run((*self._compose_prefix(project_dir, env_file, project_name), "ps", "-q", service))
        if result.returncode != 0:
            return None
        return result.stdout.strip() or None

    def container_state(self, container_id: str) -> tuple[str | None, str | None]:
        result = self.runner.run((
            "docker", "inspect", "--format",
            "{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}",
            container_id,
        ))
        if result.returncode != 0:
            return None, None
        raw = result.stdout.strip()
        state, _, health = raw.partition("|")
        return state or None, health or None

    def compose_exec(
        self,
        project_dir: Path,
        env_file: Path,
        service: str,
        command: tuple[str, ...],
        *,
        project_name: str = "spark-supabase",
        timeout: int = 30,
    ) -> CommandResult:
        return self.runner.run(
            (*self._compose_prefix(project_dir, env_file, project_name), "exec", "-T", service, *command),
            timeout=timeout,
        )

    def compose_logs(
        self,
        project_dir: Path,
        env_file: Path,
        service: str,
        *,
        project_name: str = "spark-supabase",
        tail: int = 200,
    ) -> str:
        result = self.runner.run((
            *self._compose_prefix(project_dir, env_file, project_name),
            "logs", "--no-color", "--tail", str(tail), service,
        ))
        return result.stdout + result.stderr

    def compose_ps(self, project_dir: Path, env_file: Path, project_name: str = "spark-supabase") -> str:
        result = self.runner.run((*self._compose_prefix(project_dir, env_file, project_name), "ps", "--all"))
        return result.stdout + result.stderr
