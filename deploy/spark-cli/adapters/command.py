from __future__ import annotations

import subprocess
from dataclasses import dataclass
from typing import Iterable


@dataclass(frozen=True)
class CommandResult:
    returncode: int
    stdout: str
    stderr: str


class CommandRunner:
    def run(self, args: Iterable[str], *, check: bool = False, input_text: str | None = None) -> CommandResult:
        completed = subprocess.run(
            tuple(args),
            input=input_text,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
        result = CommandResult(completed.returncode, completed.stdout, completed.stderr)
        if check and completed.returncode != 0:
            raise RuntimeError(f"command failed with exit code {completed.returncode}")
        return result
