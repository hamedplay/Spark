from __future__ import annotations

import socket
import urllib.error
import urllib.request
from pathlib import Path

from config.models import ApplicationEdgeConfig, EnvironmentConfig

from .models import EdgeHealth
from .runtime import EdgeRuntimeManager


def _tcp(host: str, port: int, timeout: float = 2.0) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def _database_host(environment: EnvironmentConfig) -> str:
    for node in environment.nodes.values():
        if node.role == "database":
            return node.host
    raise ValueError("database node missing from profile")


class EdgeVerifier:
    def __init__(self, runtime: EdgeRuntimeManager | None = None) -> None:
        self.runtime = runtime or EdgeRuntimeManager()

    @staticmethod
    def probe_status(config: ApplicationEdgeConfig) -> int | None:
        url = f"http://127.0.0.1:{config.port}/{config.probe_function}"
        request = urllib.request.Request(url, method="GET")
        try:
            with urllib.request.urlopen(request, timeout=3) as response:
                return int(response.status)
        except urllib.error.HTTPError as exc:
            return int(exc.code)
        except (urllib.error.URLError, TimeoutError, OSError):
            return None

    def inspect(self, environment: EnvironmentConfig) -> EdgeHealth:
        config = environment.application.edge
        root = Path(config.root)
        return EdgeHealth(
            runtime_running=self.runtime.running(config),
            functions_present=(root / "functions/main/index.ts").is_file() and any(
                path.is_dir() and (path / "index.ts").is_file() and path.name not in {"main", "_shared"}
                for path in (root / "functions").iterdir()
            ) if (root / "functions").is_dir() else False,
            supabase_reachable=_tcp(_database_host(environment), 8000),
            probe_status=self.probe_status(config),
        )
