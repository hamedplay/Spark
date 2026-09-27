from __future__ import annotations

import json
import os
import shutil
from dataclasses import asdict
from pathlib import Path

from adapters.command import CommandRunner
from config.models import ApplicationEdgeConfig

from .functions import inventory_functions, tree_hash
from .models import EdgeDeploymentIdentity

DENO_JSON = '''{
  "imports": {
    "@supabase/functions-js": "jsr:@supabase/functions-js@^2",
    "@supabase/server": "npm:@supabase/server@^1"
  }
}\n'''


class EdgeRuntimeManager:
    def __init__(self, runner: CommandRunner | None = None) -> None:
        self.runner = runner or CommandRunner()

    @staticmethod
    def identity(release: str | Path, source_sha: str, config: ApplicationEdgeConfig) -> EdgeDeploymentIdentity:
        release = Path(release)
        functions = release / "supabase/functions"
        router = release / "deploy/spark-cli/edge-main/index.ts"
        if not functions.is_dir() or not router.is_file():
            raise RuntimeError("Spark Edge Functions/router source is missing from release")
        source_digest = tree_hash(functions) + ":" + tree_hash(router.parent)
        import hashlib
        normalized = hashlib.sha256(source_digest.encode()).hexdigest()
        return EdgeDeploymentIdentity(source_sha, normalized, config.image, inventory_functions(functions))

    @staticmethod
    def _compose(config: ApplicationEdgeConfig) -> str:
        verify = "true" if config.verify_jwt else "false"
        return f'''services:\n  functions:\n    container_name: spark-edge-runtime\n    image: {config.image}\n    restart: unless-stopped\n    ports:\n      - "{config.port}:9000"\n    env_file:\n      - /opt/spark/application/shared/runtime.env\n      - /etc/spark-manager/secrets/application.env\n    environment:\n      VERIFY_JWT: "{verify}"\n    volumes:\n      - ./functions:/home/deno/functions:ro\n    command: ["start", "--main-service", "/home/deno/functions/main"]\n'''

    @staticmethod
    def _atomic_write(path: Path, content: str, mode: int = 0o600) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        temp = path.with_name(path.name + ".tmp")
        fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, mode)
        try:
            with os.fdopen(fd, "w") as handle:
                handle.write(content)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temp, path)
            os.chmod(path, mode)
        finally:
            temp.unlink(missing_ok=True)

    def prepare(self, release: str | Path, source_sha: str, config: ApplicationEdgeConfig, *, dry_run: bool = False) -> tuple[EdgeDeploymentIdentity, bool]:
        release = Path(release)
        identity = self.identity(release, source_sha, config)
        root = Path(config.root)
        metadata = root / "edge-metadata.json"
        expected = json.dumps({
            "source_sha": identity.source_sha,
            "source_sha256": identity.source_sha256,
            "runtime_image": identity.runtime_image,
            "functions": [asdict(value) for value in identity.functions],
        }, sort_keys=True, indent=2) + "\n"
        if metadata.is_file() and metadata.read_text() == expected and (root / "functions/main/index.ts").is_file():
            return identity, False
        if dry_run:
            return identity, True
        staged = root.with_name(root.name + ".new")
        if staged.exists():
            shutil.rmtree(staged)
        (staged / "functions").mkdir(parents=True)
        shutil.copytree(release / "supabase/functions", staged / "functions", dirs_exist_ok=True)
        main_dir = staged / "functions/main"
        main_dir.mkdir(parents=True, exist_ok=True)
        shutil.copy2(release / "deploy/spark-cli/edge-main/index.ts", main_dir / "index.ts")
        self._atomic_write(staged / "functions/deno.jsonc", DENO_JSON, 0o644)
        self._atomic_write(staged / "docker-compose.yml", self._compose(config), 0o600)
        self._atomic_write(staged / "edge-metadata.json", expected, 0o600)
        backup = root.with_name(root.name + ".previous")
        if backup.exists():
            shutil.rmtree(backup)
        if root.exists():
            os.replace(root, backup)
        os.replace(staged, root)
        if backup.exists():
            shutil.rmtree(backup)
        return identity, True

    def start(self, config: ApplicationEdgeConfig, *, dry_run: bool = False) -> bool:
        root = Path(config.root)
        if dry_run:
            return True
        result = self.runner.run(("docker", "compose", "-p", config.project_name, "-f", str(root / "docker-compose.yml"), "up", "-d", "functions"), timeout=300)
        if result.returncode != 0:
            raise RuntimeError("Edge Runtime container start failed")
        return True

    def running(self, config: ApplicationEdgeConfig) -> bool:
        result = self.runner.run(("docker", "inspect", "-f", "{{.State.Running}}", "spark-edge-runtime"), timeout=15)
        return result.returncode == 0 and result.stdout.strip().lower() == "true"
