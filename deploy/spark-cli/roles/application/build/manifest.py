from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from config.yaml_loader import safe_load_profile


@dataclass(frozen=True)
class BuildManifest:
    node_requirement: str
    package_manager: str
    install_command: tuple[str, ...]
    build_command: tuple[str, ...]
    build_env_allow: tuple[str, ...]
    artifact_root: str
    required_artifacts: tuple[str, ...]
    deployment_type: str
    document_root: str
    current_link: str
    health_host: str
    health_path: str
    health_port: int
    health_timeout_seconds: int
    health_interval_seconds: int
    health_marker: str


def load_build_manifest(path: str | Path) -> BuildManifest:
    data = safe_load_profile(Path(path).read_text())
    if int(data.get("schema_version", 0)) != 1:
        raise ValueError("unsupported Spark build manifest schema_version")
    if ((data.get("application") or {}).get("type")) != "static":
        raise ValueError("M4.3 supports only application.type=static")
    runtime = (data.get("runtime") or {}).get("node") or {}
    install = data.get("install") or {}
    build = data.get("build") or {}
    artifacts = data.get("artifacts") or {}
    deployment = data.get("deployment") or {}
    health = data.get("health") or {}
    install_command = tuple(str(x) for x in (install.get("command") or ()))
    build_command = tuple(str(x) for x in (build.get("command") or ()))
    if install_command != ("npm", "ci"):
        raise ValueError("production install command must be exactly: npm ci")
    if not build_command:
        raise ValueError("build command is required")
    if "install" in build_command:
        raise ValueError("npm install is prohibited in production build flow")
    return BuildManifest(
        node_requirement=str(runtime.get("requirement", "")),
        package_manager=str(runtime.get("package_manager", "")),
        install_command=install_command,
        build_command=build_command,
        build_env_allow=tuple(str(x) for x in (((build.get("environment") or {}).get("allow")) or ())),
        artifact_root=str(artifacts.get("root", "dist")),
        required_artifacts=tuple(str(x) for x in (artifacts.get("required") or ())),
        deployment_type=str(deployment.get("type", "")),
        document_root=str(deployment.get("document_root", "dist")),
        current_link=str(deployment.get("current_link", "/opt/spark/application/current")),
        health_host=str(health.get("host", "127.0.0.1")),
        health_path=str(health.get("path", "/")),
        health_port=int(health.get("port", 80)),
        health_timeout_seconds=int(health.get("timeout_seconds", 120)),
        health_interval_seconds=int(health.get("interval_seconds", 3)),
        health_marker=str(health.get("marker", "")),
    )
