from __future__ import annotations

import json
import shutil
import tempfile
from dataclasses import dataclass
from pathlib import Path

from .overlay import build_database_compose
from .source import GitPackageSource, PackageSource
from .verifier import verify_package
from .version import read_installed_release, write_installed_release


@dataclass(frozen=True)
class SupabasePackageSpec:
    release: str
    source_url: str
    destination: Path


class SupabasePackageManager:
    def __init__(self, source: PackageSource | None = None) -> None:
        self.source = source or GitPackageSource()

    def detect(self, spec: SupabasePackageSpec) -> dict[str, object]:
        root = spec.destination
        installed = read_installed_release(root)
        healthy = False
        if installed == spec.release:
            try:
                verify_package(root, spec.release)
                healthy = True
            except ValueError:
                healthy = False
        return {
            "present": root.exists(),
            "installed_release": installed,
            "expected_release": spec.release,
            "healthy": healthy,
        }

    def plan(self, spec: SupabasePackageSpec) -> dict[str, object]:
        state = self.detect(spec)
        if state["healthy"]:
            return {"action": "reuse", **state}
        return {"action": "materialize", **state}

    def materialize(self, spec: SupabasePackageSpec) -> None:
        if self.detect(spec)["healthy"]:
            return
        destination = spec.destination
        destination.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="spark-supabase-") as temp_dir:
            temp = Path(temp_dir)
            source_root = self.source.acquire(spec.source_url, spec.release, temp / "source")
            staging = temp / "staging"
            vendor = staging / "vendor" / "upstream"
            shutil.copytree(source_root, vendor, symlinks=True)
            staging.mkdir(parents=True, exist_ok=True)
            for name in (".env.example", "run.sh", "update.sh"):
                source = vendor / name
                if not source.exists():
                    raise RuntimeError(f"pinned Supabase release is missing required file: {name}")
                shutil.copy2(source, staging / name)
            build_database_compose(vendor / "docker-compose.yml", staging / "docker-compose.yml")
            (staging / "spark" / "overrides").mkdir(parents=True, exist_ok=True)
            metadata = {
                "schema_version": 1,
                "component": "supabase",
                "source": "upstream",
                "release": spec.release,
                "edge_functions": False,
            }
            (staging / "spark" / "metadata.json").write_text(json.dumps(metadata, indent=2) + "\n")
            (staging / "volumes").mkdir(exist_ok=True)
            write_installed_release(staging, spec.release)
            verify_package(staging, spec.release)
            backup = destination.with_name(destination.name + ".previous")
            if backup.exists():
                shutil.rmtree(backup)
            if destination.exists():
                destination.rename(backup)
            try:
                shutil.copytree(staging, destination, symlinks=True)
                verify_package(destination, spec.release)
            except Exception:
                if destination.exists():
                    shutil.rmtree(destination)
                if backup.exists():
                    backup.rename(destination)
                raise
            if backup.exists():
                shutil.rmtree(backup)
