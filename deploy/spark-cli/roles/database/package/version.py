from __future__ import annotations

from pathlib import Path


def read_installed_release(destination: str | Path) -> str | None:
    path = Path(destination) / ".supabase-version"
    if not path.is_file():
        return None
    for line in path.read_text().splitlines():
        if line.startswith("ref="):
            return line.split("=", 1)[1].strip() or None
    return None


def write_installed_release(destination: str | Path, release: str) -> None:
    path = Path(destination) / ".supabase-version"
    path.write_text(f"ref={release}\n")
