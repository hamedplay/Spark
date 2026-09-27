from __future__ import annotations

import hashlib
from pathlib import Path

from .models import EdgeFunctionIdentity


def _file_hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def tree_hash(root: str | Path) -> str:
    root = Path(root)
    digest = hashlib.sha256()
    for path in sorted(p for p in root.rglob("*") if p.is_file()):
        rel = path.relative_to(root).as_posix()
        digest.update(rel.encode())
        digest.update(b"\0")
        digest.update(_file_hash(path).encode())
        digest.update(b"\0")
    return digest.hexdigest()


def inventory_functions(functions_root: str | Path) -> tuple[EdgeFunctionIdentity, ...]:
    root = Path(functions_root)
    identities: list[EdgeFunctionIdentity] = []
    for item in sorted(root.iterdir(), key=lambda p: p.name) if root.is_dir() else ():
        if not item.is_dir() or item.name.startswith("_") or item.name == "main":
            continue
        if not (item / "index.ts").is_file():
            continue
        identities.append(EdgeFunctionIdentity(item.name, tree_hash(item)))
    return tuple(identities)
