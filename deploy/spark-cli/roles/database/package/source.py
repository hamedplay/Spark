from __future__ import annotations

import shutil
import subprocess
from pathlib import Path
from typing import Protocol


class PackageSource(Protocol):
    def acquire(self, source_url: str, release: str, destination: Path) -> Path: ...


class GitPackageSource:
    def acquire(self, source_url: str, release: str, destination: Path) -> Path:
        if destination.exists():
            shutil.rmtree(destination)
        destination.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(
            [
                "git",
                "clone",
                "--filter=blob:none",
                "--no-checkout",
                "--depth=1",
                "--quiet",
                "--branch",
                release,
                source_url,
                str(destination),
            ],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        subprocess.run(
            ["git", "-C", str(destination), "sparse-checkout", "init", "--cone"],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        subprocess.run(
            ["git", "-C", str(destination), "sparse-checkout", "set", "docker"],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        subprocess.run(
            ["git", "-C", str(destination), "checkout", "--quiet", release],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        docker_dir = destination / "docker"
        if not docker_dir.is_dir():
            raise RuntimeError("Supabase package does not contain docker/ at the pinned release")
        return docker_dir


class LocalArchivePackageSource:
    """Air-gap source contract. Archive extraction is implemented with the Air-Gap bundle phase."""

    def acquire(self, source_url: str, release: str, destination: Path) -> Path:
        raise NotImplementedError("local archive acquisition is reserved for Air-Gap bundle integration")
