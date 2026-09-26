from __future__ import annotations

import os
from datetime import datetime, timezone
from pathlib import Path

from adapters import DockerAdapter
from config.models import EnvironmentConfig
from secrets.redaction import SecretRedactor


class StartupDiagnostics:
    def __init__(
        self,
        docker: DockerAdapter | None = None,
        redactor: SecretRedactor | None = None,
        log_root: str | Path = "/var/log/spark-manager/database",
    ) -> None:
        self.docker = docker or DockerAdapter()
        self.redactor = redactor or SecretRedactor()
        self.log_root = Path(log_root)

    def capture(self, profile: EnvironmentConfig, operation: str, failed_service: str | None = None) -> Path:
        root = Path(profile.database.supabase.destination)
        env_file = root / ".env"
        project = profile.database.compose.project_name
        parts = [
            f"timestamp={datetime.now(timezone.utc).isoformat()}",
            f"operation={operation}",
            "",
            "[compose ps]",
            self.docker.compose_ps(root, env_file, project),
            "",
            "[compose services]",
            "\n".join(self.docker.compose_services(root, env_file, project)),
            "",
            "[disk]",
            self.docker.runner.run(("df", "-h", str(root))).stdout,
            "",
            "[docker daemon]",
            self.docker.runner.run(("docker", "info", "--format", "ServerVersion={{.ServerVersion}} Driver={{.Driver}} Containers={{.Containers}} Images={{.Images}}" )).stdout,
        ]
        if failed_service:
            container_id = self.docker.service_container_id(root, env_file, failed_service, project)
            parts.extend(("", f"[service {failed_service}]", f"container_id={container_id or 'none'}"))
            if container_id:
                state, health = self.docker.container_state(container_id)
                parts.extend((f"state={state or 'unknown'}", f"health={health or 'none'}"))
            parts.extend(("", "[recent logs]", self.docker.compose_logs(root, env_file, failed_service, project_name=project, tail=200)))
        content = self.redactor.redact("\n".join(parts)).rstrip() + "\n"
        self.log_root.mkdir(parents=True, exist_ok=True)
        if os.geteuid() == 0:
            os.chmod(self.log_root, 0o750)
        path = self.log_root / f"{operation}.log"
        tmp = path.with_suffix(".tmp")
        tmp.write_text(content)
        os.chmod(tmp, 0o600)
        os.replace(tmp, path)
        return path
