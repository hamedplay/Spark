from __future__ import annotations

from config.models import EnvironmentConfig

from .runtime import EdgeRuntimeManager
from .verifier import EdgeVerifier


class EdgeDeploymentController:
    def __init__(self, runtime: EdgeRuntimeManager | None = None, verifier: EdgeVerifier | None = None) -> None:
        self.runtime = runtime or EdgeRuntimeManager()
        self.verifier = verifier or EdgeVerifier(self.runtime)

    def deploy(self, release: str, source_sha: str, environment: EnvironmentConfig, *, dry_run: bool = False) -> dict[str, object]:
        identity, changed = self.runtime.prepare(release, source_sha, environment.application.edge, dry_run=dry_run)
        if not dry_run:
            self.runtime.start(environment.application.edge)
        health = None if dry_run else self.verifier.inspect(environment)
        return {
            "changed": changed,
            "identity": identity,
            "health": health,
        }
