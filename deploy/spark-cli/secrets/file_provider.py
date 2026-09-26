from __future__ import annotations

import os
from pathlib import Path
from typing import Callable

from .models import SecretState


class FileSecretProvider:
    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)

    def _read(self) -> dict[str, str]:
        if not self.path.exists():
            return {}
        values: dict[str, str] = {}
        for raw in self.path.read_text().splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            values[key.strip()] = value
        return values

    def _assert_permissions(self) -> None:
        if not self.path.exists():
            return
        file_mode = self.path.stat().st_mode & 0o777
        dir_mode = self.path.parent.stat().st_mode & 0o777
        if file_mode != 0o600 or dir_mode != 0o700:
            raise PermissionError(
                f"secret storage permissions invalid: directory={oct(dir_mode)} file={oct(file_mode)}"
            )
        if os.geteuid() == 0:
            stat = self.path.stat()
            if stat.st_uid != 0 or stat.st_gid != 0:
                raise PermissionError("secret storage must be owned by root:root")

    def exists(self, key: str) -> bool:
        return bool(self._read().get(key))

    def get(self, key: str) -> str:
        self._assert_permissions()
        values = self._read()
        if key not in values or not values[key]:
            raise KeyError(key)
        return values[key]

    def set(self, key: str, value: str) -> None:
        if not key or "=" in key or "\n" in key:
            raise ValueError("invalid secret key")
        if not value or "\n" in value or "\r" in value:
            raise ValueError(f"invalid secret value for {key}")
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(self.path.parent, 0o700)
        values = self._read()
        values[key] = value
        tmp = self.path.with_suffix(self.path.suffix + ".tmp")
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        try:
            with os.fdopen(fd, "w") as handle:
                for name in sorted(values):
                    handle.write(f"{name}={values[name]}\n")
                    handle.flush()
                os.fsync(handle.fileno())
            os.replace(tmp, self.path)
            os.chmod(self.path, 0o600)
        finally:
            if tmp.exists():
                tmp.unlink()

    def ensure(self, key: str, generator: Callable[[], str]) -> str:
        if self.exists(key):
            return self.get(key)
        value = generator()
        self.set(key, value)
        return value

    def inspect(self, key: str) -> SecretState:
        if not self.path.exists() or not self.exists(key):
            return SecretState.MISSING
        try:
            self._assert_permissions()
            value = self.get(key)
        except (PermissionError, KeyError, OSError):
            return SecretState.INVALID
        return SecretState.PRESENT if value else SecretState.INVALID

    def validate_storage(self) -> None:
        self._assert_permissions()
