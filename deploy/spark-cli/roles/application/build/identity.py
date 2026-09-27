from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, asdict
from pathlib import Path


@dataclass(frozen=True)
class BuildIdentity:
    source_sha: str
    lockfile_sha256: str
    manifest_sha256: str

    def digest(self) -> str:
        payload = json.dumps(asdict(self), sort_keys=True, separators=(",", ":")).encode()
        return hashlib.sha256(payload).hexdigest()


def sha256_file(path: str | Path) -> str:
    h = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def build_identity(release: str | Path, source_sha: str, manifest_path: str | Path) -> BuildIdentity:
    release = Path(release)
    lockfile = release / "package-lock.json"
    if not lockfile.is_file():
        raise RuntimeError("REFUSED: package-lock.json is required for reproducible production build")
    return BuildIdentity(source_sha, sha256_file(lockfile), sha256_file(manifest_path))
