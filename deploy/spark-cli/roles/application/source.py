from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

from adapters.command import CommandRunner
from config.models import ApplicationSourceConfig

_SHA_RE = re.compile(r"^[0-9a-f]{40}$")


@dataclass(frozen=True)
class SourcePlan:
    repository: str
    requested_revision: str
    resolved_commit: str
    release_path: str


class ApplicationSourceManager:
    def __init__(self, runner: CommandRunner | None = None) -> None:
        self.runner = runner or CommandRunner()

    def resolve(self, config: ApplicationSourceConfig) -> SourcePlan:
        result = self.runner.run(("git", "ls-remote", config.repository, config.revision), timeout=30)
        if result.returncode != 0 or not result.stdout.strip():
            raise RuntimeError("unable to resolve requested application revision")
        commit = result.stdout.split()[0].strip().lower()
        if not _SHA_RE.fullmatch(commit):
            raise RuntimeError("repository returned an invalid commit SHA")
        return SourcePlan(config.repository, config.revision, commit, str(Path(config.releases_root) / commit))

    def detect(self, plan: SourcePlan) -> bool:
        path = Path(plan.release_path)
        if not path.is_dir():
            return False
        result = self.runner.run(("git", "-C", str(path), "rev-parse", "HEAD"), timeout=10)
        return result.returncode == 0 and result.stdout.strip().lower() == plan.resolved_commit

    def materialize(self, plan: SourcePlan) -> bool:
        target = Path(plan.release_path)
        if self.detect(plan):
            return False
        if target.exists():
            raise RuntimeError(f"release path exists but does not match requested commit: {target}")
        target.parent.mkdir(parents=True, exist_ok=True)
        clone = self.runner.run(("git", "clone", "--no-checkout", plan.repository, str(target)), timeout=300)
        if clone.returncode != 0:
            raise RuntimeError("application repository clone failed")
        checkout = self.runner.run(("git", "-C", str(target), "checkout", "--detach", plan.resolved_commit), timeout=120)
        if checkout.returncode != 0 or not self.detect(plan):
            raise RuntimeError("application revision checkout verification failed")
        return True
