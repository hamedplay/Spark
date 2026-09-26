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
        argv = tuple(args)
        try:
            completed = subprocess.run(
                argv,
                input=input_text,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=False,
            )
            result = CommandResult(completed.returncode, completed.stdout, completed.stderr)
        except FileNotFoundError:
            result = CommandResult(127, "", "command not found")
        if check and result.returncode != 0:
            raise RuntimeError(f"command failed with exit code {result.returncode}")
        return result
