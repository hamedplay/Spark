from __future__ import annotations

import argparse

from .controller import run_action

COMMANDS = {
    "show": "architecture-overview",
    "profile": "architecture-profile",
    "validate": "architecture-validate",
    "network-check": "architecture-network",
    "status": "architecture-status",
}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="spark-architecture")
    parser.add_argument("command", choices=COMMANDS)
    args = parser.parse_args(argv)
    result = run_action(COMMANDS[args.command])
    print(result.title)
    print("=" * len(result.title))
    for line in result.lines:
        print(line)
    return 0 if result.success else 1


if __name__ == "__main__":
    raise SystemExit(main())
