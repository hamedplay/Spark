from __future__ import annotations

from pathlib import Path


def _indent(line: str) -> int:
    return len(line) - len(line.lstrip(" "))


def _remove_mapping_block(lines: list[str], key: str, indent: int) -> list[str]:
    result: list[str] = []
    index = 0
    needle = f"{key}:"
    while index < len(lines):
        line = lines[index]
        if _indent(line) == indent and line.strip() == needle:
            index += 1
            while index < len(lines) and (_indent(lines[index]) > indent or not lines[index].strip()):
                index += 1
            continue
        result.append(line)
        index += 1
    return result


def remove_service(compose_text: str, service: str) -> str:
    lines = compose_text.splitlines()
    services_index = next((i for i, line in enumerate(lines) if _indent(line) == 0 and line.strip() == "services:"), None)
    if services_index is None:
        raise ValueError("compose file has no top-level services mapping")
    lines = _remove_mapping_block(lines, service, 2)
    for indent in range(4, 18, 2):
        lines = _remove_mapping_block(lines, service, indent)
    filtered = [
        line
        for line in lines
        if "./volumes/functions" not in line
        and "EDGE_FUNCTIONS_MANAGEMENT_FOLDER" not in line
    ]
    return "\n".join(filtered).rstrip() + "\n"


def ensure_supavisor_nofile(compose_text: str) -> str:
    lines = compose_text.splitlines()
    service_index = next(
        (index for index, line in enumerate(lines) if _indent(line) == 2 and line.strip() in {"supavisor:", "pooler:"}),
        None,
    )
    if service_index is None:
        return compose_text if compose_text.endswith("\n") else compose_text + "\n"
    service_end = service_index + 1
    while service_end < len(lines) and (_indent(lines[service_end]) > 2 or not lines[service_end].strip()):
        service_end += 1
    if any(_indent(line) == 4 and line.strip() == "ulimits:" for line in lines[service_index + 1:service_end]):
        return compose_text if compose_text.endswith("\n") else compose_text + "\n"
    block = [
        "    ulimits:",
        "      nofile:",
        "        soft: 100000",
        "        hard: 100000",
    ]
    lines[service_index + 1:service_index + 1] = block
    return "\n".join(lines).rstrip() + "\n"


def build_database_compose(upstream_compose: str | Path, destination: str | Path) -> Path:
    source = Path(upstream_compose)
    target = Path(destination)
    target.parent.mkdir(parents=True, exist_ok=True)
    compose = remove_service(source.read_text(), "functions")
    compose = ensure_supavisor_nofile(compose)
    target.write_text(compose)
    return target
