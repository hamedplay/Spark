from __future__ import annotations

import os
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Mapping


@dataclass(frozen=True)
class CommandResult:
    returncode: int
    stdout: str
    stderr: str


class CommandRunner:
    def run(
        self,
        args: Iterable[str],
        *,
        check: bool = False,
        input_text: str | None = None,
        timeout: int | float | None = None,
        cwd: str | Path | None = None,
        env: Mapping[str, str] | None = None,
    ) -> CommandResult:
        argv = tuple(args)
        process_env = None if env is None else {str(key): str(value) for key, value in env.items()}
        try:
            completed = subprocess.run(
                argv,
                input=input_text,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=False,
                timeout=timeout,
                cwd=str(cwd) if cwd is not None else None,
                env=process_env,
            )
            result = CommandResult(completed.returncode, completed.stdout, completed.stderr)
        except FileNotFoundError:
            result = CommandResult(127, "", "command not found")
        except subprocess.TimeoutExpired:
            result = CommandResult(124, "", "command timed out")
        if check and result.returncode != 0:
            raise RuntimeError(f"command failed with exit code {result.returncode}")
        return result
