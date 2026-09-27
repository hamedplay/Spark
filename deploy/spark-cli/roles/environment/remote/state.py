from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Any


class ProductionStateStore:
    def __init__(self, path: str | Path):
        self.path = Path(path)

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
