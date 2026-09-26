from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Any


class StateStore:
    def __init__(self, root: str | Path = "/var/lib/spark-manager/workflows") -> None:
        self.root = Path(root)

    def path_for(self, workflow_id: str) -> Path:
        safe = workflow_id.replace("/", "_")
        return self.root / f"{safe}.json"

    def load(self, workflow_id: str) -> dict[str, Any]:
        path = self.path_for(workflow_id)
        if not path.exists():
            return {"workflow": workflow_id, "tasks": {}}
        return json.loads(path.read_text())

    def save(self, workflow_id: str, payload: dict[str, Any]) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        path = self.path_for(workflow_id)
        fd, tmp_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=str(self.root))
        try:
            with os.fdopen(fd, "w") as handle:
                json.dump(payload, handle, sort_keys=True, indent=2)
                handle.write("\n")
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(tmp_name, path)
        finally:
            if os.path.exists(tmp_name):
                os.unlink(tmp_name)

    def record_task(self, workflow_id: str, task_id: str, status: str, *, verified: bool = False, message: str = "") -> None:
        payload = self.load(workflow_id)
        payload.setdefault("tasks", {})[task_id] = {
            "status": status,
            "verified": verified,
            "message": message,
        }
        self.save(workflow_id, payload)
