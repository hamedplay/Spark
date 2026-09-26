from __future__ import annotations

from pathlib import Path

from .version import read_installed_release


def compose_services(compose_text: str) -> tuple[str, ...]:
    lines = compose_text.splitlines()
    in_services = False
    services: list[str] = []
    for line in lines:
        stripped = line.strip()
        indent = len(line) - len(line.lstrip(" "))
        if indent == 0 and stripped == "services:":
            in_services = True
            continue
        if in_services and indent == 0 and stripped and not stripped.startswith("#"):
            break
        if in_services and indent == 2 and stripped.endswith(":") and not stripped.startswith("#"):
            services.append(stripped[:-1])
    return tuple(services)


def verify_no_edge_functions(compose_path: str | Path) -> None:
    text = Path(compose_path).read_text()
    services = compose_services(text)
    if "functions" in services:
        raise ValueError("database compose still contains the functions service")
    if "supabase-edge-functions" in text or "supabase/edge-runtime" in text:
        raise ValueError("database compose still references Edge Runtime")


def verify_package(destination: str | Path, expected_release: str) -> None:
    root = Path(destination)
    required = (
        root / "docker-compose.yml",
        root / ".env.example",
        root / ".supabase-version",
        root / "run.sh",
        root / "update.sh",
        root / "vendor" / "upstream" / "docker-compose.yml",
        root / "spark" / "metadata.json",
    )
    missing = [str(path) for path in required if not path.exists()]
    if missing:
        raise ValueError(f"incomplete Supabase package: missing {', '.join(missing)}")
    if read_installed_release(root) != expected_release:
        raise ValueError("installed Supabase version does not match pinned release")
    verify_no_edge_functions(root / "docker-compose.yml")
