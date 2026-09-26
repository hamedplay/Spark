from __future__ import annotations

from pathlib import Path

from adapters import DockerAdapter
from config.models import EnvironmentConfig
from .models import ImageReadiness, RequiredImage


class DatabaseImageManager:
    def __init__(self, docker: DockerAdapter | None = None) -> None:
        self.docker = docker or DockerAdapter()

    def inventory(self, profile: EnvironmentConfig) -> tuple[RequiredImage, ...]:
        root = Path(profile.database.supabase.destination)
        env_file = root / ".env"
        images = self.docker.compose_service_images(root, env_file, profile.database.compose.project_name)
        result = []
        for service, reference in sorted(images.items()):
            image_id = self.docker.image_id(reference)
            result.append(RequiredImage(service, reference, image_id is not None, image_id))
        return tuple(result)

    def status(self, profile: EnvironmentConfig) -> ImageReadiness:
        inventory = self.inventory(profile)
        if not inventory:
            return ImageReadiness.FAILED
        present = sum(1 for image in inventory if image.present)
        if present == len(inventory):
            return ImageReadiness.READY
        if present:
            return ImageReadiness.PARTIAL
        return ImageReadiness.FAILED

    def plan(self, profile: EnvironmentConfig) -> dict[str, object]:
        inventory = self.inventory(profile)
        missing = tuple(image.service for image in inventory if not image.present)
        blocked = ()
        if profile.mode == "airgap" and missing:
            blocked = ("air-gap mode requires all images to be loaded locally",)
        return {
            "status": self.status(profile).value,
            "missing_services": missing,
            "blocked": blocked,
            "image_count": len(inventory),
        }

    def acquire(self, profile: EnvironmentConfig) -> bool:
        plan = self.plan(profile)
        missing = tuple(plan["missing_services"])
        if not missing:
            return False
        if profile.mode == "airgap":
            raise RuntimeError("database images are incomplete in air-gap mode")
        root = Path(profile.database.supabase.destination)
        result = self.docker.compose_pull(
            root,
            root / ".env",
            missing,
            project_name=profile.database.compose.project_name,
            timeout=profile.database.startup.image_pull_timeout_seconds,
        )
        if result.returncode != 0:
            raise RuntimeError("database image acquisition failed")
        remaining = tuple(image.service for image in self.inventory(profile) if not image.present)
        if remaining:
            raise RuntimeError("database image verification failed after pull")
        return True
