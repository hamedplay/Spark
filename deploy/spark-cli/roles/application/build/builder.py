from __future__ import annotations

import json
import os
import re
from pathlib import Path

from adapters.command import CommandRunner
from .identity import build_identity
from .manifest import load_build_manifest

SENSITIVE_BUILD_TOKENS = ("SERVICE_ROLE", "PASSWORD", "SECRET", "PRIVATE_KEY", "JWT_SECRET")


class StaticApplicationBuilder:
    def __init__(self, runner: CommandRunner | None = None) -> None:
        self.runner = runner or CommandRunner()

    def _node_ok(self, requirement: str) -> tuple[bool, str]:
        result = self.runner.run(("node", "--version"), timeout=15)
        if result.returncode != 0:
            return False, "missing"
        raw = result.stdout.strip().lstrip("v")
        match = re.fullmatch(r"(\d+)\.(\d+)\.(\d+)", raw)
        if not match:
            return False, raw
        version = tuple(map(int, match.groups()))
        return ((24, 21, 0) <= version < (25, 0, 0), raw) if requirement == ">=24.21.0 <25" else (False, raw)

    def _verify_artifacts(self, release: Path, required: tuple[str, ...]) -> None:
        for value in required:
            path = release / value
            if not path.exists():
                raise RuntimeError(f"artifact verification failed: missing {value}")
            if path.is_file() and path.stat().st_size == 0:
                raise RuntimeError(f"artifact verification failed: empty {value}")
            if path.is_dir() and not any(path.iterdir()):
                raise RuntimeError(f"artifact verification failed: empty {value}")
        index = release / "dist/index.html"
        text = index.read_text(errors="ignore")
        if "/assets/" not in text and "assets/" not in text:
            raise RuntimeError("artifact verification failed: index.html does not reference generated assets")
        upper = text.upper()
        if any(token in upper for token in SENSITIVE_BUILD_TOKENS):
            raise RuntimeError("artifact verification failed: sensitive marker detected in index.html")

    def build(self, release: str | Path, source_sha: str, manifest_path: str | Path, *, build_env: dict[str, str] | None = None, dry_run: bool = False) -> dict:
        release = Path(release)
        manifest = load_build_manifest(manifest_path)
        ok, node_version = self._node_ok(manifest.node_requirement)
        if not ok:
            raise RuntimeError(f"NODE_VERSION_MISMATCH: found {node_version}, required {manifest.node_requirement}")
        identity = build_identity(release, source_sha, manifest_path)
        meta_dir = release / ".spark"
        meta = meta_dir / "build-metadata.json"
        if meta.is_file():
            try:
                current = json.loads(meta.read_text())
                if current.get("build_identity") == identity.digest():
                    self._verify_artifacts(release, manifest.required_artifacts)
                    return {"changed": False, "status": "VERIFIED", "build_identity": identity.digest(), "node_version": node_version}
            except (OSError, ValueError, RuntimeError):
                pass
        supplied = build_env or {}
        for key in supplied:
            upper = key.upper()
            if any(token in upper for token in SENSITIVE_BUILD_TOKENS):
                raise RuntimeError(f"REFUSED: sensitive variable {key} cannot enter frontend build")
            if key not in manifest.build_env_allow:
                raise RuntimeError(f"REFUSED: build environment variable {key} is not allowlisted")
        plan = {"changed": True, "status": "PLANNED", "build_identity": identity.digest(), "node_version": node_version, "install_command": list(manifest.install_command), "build_command": list(manifest.build_command)}
        if dry_run:
            return plan
        env = {"PATH": os.environ.get("PATH", ""), "HOME": os.environ.get("HOME", str(release))}
        env.update(supplied)
        for command in (manifest.install_command, manifest.build_command):
            result = self.runner.run(command, cwd=release, env=env, timeout=1800)
            if result.returncode != 0:
                raise RuntimeError(f"application build command failed: {' '.join(command)}")
        self._verify_artifacts(release, manifest.required_artifacts)
        meta_dir.mkdir(mode=0o755, exist_ok=True)
        payload = {"source_sha": identity.source_sha, "lockfile_sha256": identity.lockfile_sha256, "manifest_sha256": identity.manifest_sha256, "build_identity": identity.digest(), "status": "VERIFIED"}
        tmp = meta.with_suffix(".tmp")
        tmp.write_text(json.dumps(payload, sort_keys=True, separators=(",", ":")))
        os.replace(tmp, meta)
        return {"changed": True, **payload, "node_version": node_version}
