from __future__ import annotations

from pathlib import Path

from .command import CommandRunner


class AptAdapter:
    def __init__(self, runner: CommandRunner | None = None) -> None:
        self.runner = runner or CommandRunner()

    def is_installed(self, package: str) -> bool:
        return self.runner.run(("dpkg-query", "-W", "-f=${Status}", package)).stdout.strip() == "install ok installed"

    def installed_conflicts(self, packages: tuple[str, ...]) -> tuple[str, ...]:
        return tuple(package for package in packages if self.is_installed(package))

    def update(self) -> None:
        self.runner.run(("apt-get", "update"), check=True)

    def install(self, packages: tuple[str, ...]) -> None:
        self.runner.run(("apt-get", "install", "-y", *packages), check=True)

    def remove(self, packages: tuple[str, ...]) -> None:
        if packages:
            self.runner.run(("apt-get", "remove", "-y", *packages), check=True)

    def configure_docker_repository(self, *, codename: str, architecture: str) -> None:
        keyring_dir = Path("/etc/apt/keyrings")
        source = Path("/etc/apt/sources.list.d/docker.sources")
        keyring_dir.mkdir(parents=True, exist_ok=True)
        self.install(("ca-certificates", "curl"))
        self.runner.run(("curl", "-fsSL", "https://download.docker.com/linux/ubuntu/gpg", "-o", "/etc/apt/keyrings/docker.asc"), check=True)
        Path("/etc/apt/keyrings/docker.asc").chmod(0o644)
        content = (
            "Types: deb\n"
            "URIs: https://download.docker.com/linux/ubuntu\n"
            f"Suites: {codename}\n"
            "Components: stable\n"
            f"Architectures: {architecture}\n"
            "Signed-By: /etc/apt/keyrings/docker.asc\n"
        )
        source.write_text(content)
        source.chmod(0o644)
