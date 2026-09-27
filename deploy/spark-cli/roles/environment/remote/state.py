from __future__ import annotations

import fcntl
import json
import os
import tempfile
from pathlib import Path
from typing import Any


class NodeExecutionLock:
    def __init__(self, root: str | Path, node_id: str):
        self.path = Path(root) / f"{node_id}.lock"
        self.handle = None

    def __enter__(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.handle = self.path.open("a+")
        try:
            fcntl.flock(self.handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            self.handle.close()
            self.handle = None
            raise RuntimeError(f"execution lock is already held for {self.path.stem}") from exc
        self.handle.seek(0)
        self.handle.truncate()
        self.handle.write(str(os.getpid()))
        self.handle.flush()
        return self

    def __exit__(self, exc_type, exc, tb):
        if self.handle is not None:
            fcntl.flock(self.handle.fileno(), fcntl.LOCK_UN)
            self.handle.close()
            self.handle = None


class ProductionStateStore:
    def __init__(self, path: str | Path):
        self.path = Path(path)

    @property
    def lock_root(self) -> Path:
        return self.path.parent / "locks"

    def node_lock(self, node_id: str) -> NodeExecutionLock:
        return NodeExecutionLock(self.lock_root, node_id)

    def load(self) -> dict[str, Any]:
        if not self.path.is_file():
            return {"environment": "NEW", "steps": {}}
        try:
            value = json.loads(self.path.read_text())
        except (OSError, json.JSONDecodeError):
            return {"environment": "UNKNOWN", "steps": {}}
        if not isinstance(value, dict):
            return {"environment": "UNKNOWN", "steps": {}}
        value.setdefault("steps", {})
        return value

    def save(self, value: dict[str, Any]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        fd, temporary = tempfile.mkstemp(prefix=f".{self.path.name}.", dir=str(self.path.parent))
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                json.dump(value, handle, indent=2, sort_keys=True)
                handle.write("\n")
                handle.flush()
                os.fsync(handle.fileno())
            os.chmod(temporary, 0o600)
            os.replace(temporary, self.path)
        except Exception:
            try:
                os.unlink(temporary)
            except FileNotFoundError:
                pass
            raise

    def set_step(self, name: str, status: str) -> dict[str, Any]:
        value = self.load()
        value.setdefault("steps", {})[name] = status
        value["environment"] = "READY" if status == "READY" else ("FAILED" if status == "FAILED" else "PARTIAL")
        self.save(value)
        return value
