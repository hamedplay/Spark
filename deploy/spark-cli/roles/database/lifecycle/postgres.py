from __future__ import annotations

import time
from pathlib import Path

from adapters import DockerAdapter
from config.models import EnvironmentConfig
from .models import ComponentState, PostgresRuntimeState


class PostgresLifecycleManager:
    service_name = "db"

    def __init__(self, docker: DockerAdapter | None = None, *, poll_interval_seconds: float = 2.0) -> None:
        self.docker = docker or DockerAdapter()
        self.poll_interval_seconds = poll_interval_seconds

    @staticmethod
    def _data_state(root: Path) -> tuple[bool, str | None, bool]:
        data = root / "volumes" / "db" / "data"
        if not data.exists():
            return False, None, True
        entries = [path for path in data.iterdir() if path.name != "lost+found"]
        if not entries:
            return False, None, True
        version_file = data / "PG_VERSION"
        if not version_file.is_file():
            return True, None, False
        try:
            version = version_file.read_text().strip()
        except OSError:
            return True, None, False
        compatible = bool(version and version.split(".", 1)[0].isdigit() and (data / "base").is_dir())
        return True, version or None, compatible

    def detect(self, profile: EnvironmentConfig, *, with_probes: bool = False) -> PostgresRuntimeState:
        root = Path(profile.database.supabase.destination)
        env_file = root / ".env"
        project = profile.database.compose.project_name
        data_present, data_version, data_compatible = self._data_state(root)
        container_id = self.docker.service_container_id(root, env_file, self.service_name, project)
        if not container_id:
            state = ComponentState.DATA_PRESENT if data_present else ComponentState.ABSENT
            return PostgresRuntimeState(
                state, self.service_name, None, None, None,
                data_present, data_version, data_compatible,
            )
        container_state, docker_health = self.docker.container_state(container_id)
        if container_state == "running" and docker_health == "healthy":
            state = ComponentState.HEALTHY
        elif container_state == "running" and docker_health in {"starting", None}:
            state = ComponentState.STARTING
        elif container_state == "running":
            state = ComponentState.UNHEALTHY
        elif container_state in {"created", "restarting"}:
            state = ComponentState.CREATED
        elif container_state in {"exited", "dead"}:
            state = ComponentState.STOPPED
        else:
            state = ComponentState.UNKNOWN

        ready = None
        sql = None
        if with_probes and state == ComponentState.HEALTHY:
            ready = self._pg_isready(profile)
            sql = self._sql_probe(profile) if ready else False
            if not ready or not sql:
                state = ComponentState.UNHEALTHY
        return PostgresRuntimeState(
            state, self.service_name, container_id, container_state, docker_health,
            data_present, data_version, data_compatible, ready, sql,
        )

    def plan(self, profile: EnvironmentConfig) -> dict[str, object]:
        state = self.detect(profile)
        blocked = []
        actions = []
        if state.data_present and not state.data_compatible:
            blocked.append("existing PostgreSQL data is not safely identifiable")
        if state.state == ComponentState.HEALTHY:
            actions.append("verify PostgreSQL health gate")
        else:
            actions.append("start PostgreSQL service only")
            actions.append("wait for PostgreSQL health gate")
        return {
            "state": state.state.value,
            "data_present": state.data_present,
            "data_version": state.data_version,
            "actions": tuple(actions),
            "blocked": tuple(blocked),
        }

    def _pg_isready(self, profile: EnvironmentConfig) -> bool:
        root = Path(profile.database.supabase.destination)
        result = self.docker.compose_exec(
            root,
            root / ".env",
            self.service_name,
            ("sh", "-lc", 'pg_isready -h 127.0.0.1 -p "${POSTGRES_PORT:-5432}" -U postgres -d "${POSTGRES_DB:-postgres}"'),
            project_name=profile.database.compose.project_name,
            timeout=15,
        )
        return result.returncode == 0

    def _sql_probe(self, profile: EnvironmentConfig) -> bool:
        root = Path(profile.database.supabase.destination)
        result = self.docker.compose_exec(
            root,
            root / ".env",
            self.service_name,
            ("sh", "-lc", 'PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 -U postgres -d "${POSTGRES_DB:-postgres}" -tAc "SELECT 1"'),
            project_name=profile.database.compose.project_name,
            timeout=20,
        )
        return result.returncode == 0 and result.stdout.strip() == "1"

    def verify(self, profile: EnvironmentConfig) -> PostgresRuntimeState:
        state = self.detect(profile, with_probes=True)
        if state.state != ComponentState.HEALTHY or not state.pg_isready or not state.sql_probe:
            raise RuntimeError("PostgreSQL health gate failed")
        return state

    def start(self, profile: EnvironmentConfig) -> bool:
        plan = self.plan(profile)
        if plan["blocked"]:
            raise RuntimeError("PostgreSQL startup refused because existing data compatibility is unknown")
        current = self.detect(profile, with_probes=True)
        if current.state == ComponentState.HEALTHY and current.pg_isready and current.sql_probe:
            return False
        root = Path(profile.database.supabase.destination)
        timeout = (
            profile.database.startup.postgres.normal_timeout_seconds
            if current.data_present
            else profile.database.startup.postgres.initialization_timeout_seconds
        )
        result = self.docker.compose_up(
            root,
            root / ".env",
            (self.service_name,),
            project_name=profile.database.compose.project_name,
            wait=False,
            timeout=min(timeout, 120),
        )
        if result.returncode != 0:
            raise RuntimeError("PostgreSQL service start failed")
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            state = self.detect(profile)
            if state.state == ComponentState.HEALTHY and self._pg_isready(profile) and self._sql_probe(profile):
                return True
            if state.state in {ComponentState.STOPPED, ComponentState.UNHEALTHY}:
                time.sleep(self.poll_interval_seconds)
            else:
                time.sleep(self.poll_interval_seconds)
        raise RuntimeError("PostgreSQL health gate timed out")
