from __future__ import annotations

from adapters.command import CommandRunner


def detect_firewall_warnings(runner: CommandRunner | None = None) -> tuple[str, ...]:
    runner = runner or CommandRunner()
    warnings: list[str] = []
    if runner.run(("ufw", "status")).stdout.lower().startswith("status: active"):
        warnings.append("ufw-active-review-docker-published-port-bypass")
    if runner.run(("firewall-cmd", "--state")).returncode == 0:
        warnings.append("firewalld-active-review-docker-zone-policy")
    nft = runner.run(("nft", "list", "ruleset"))
    if nft.returncode == 0 and nft.stdout.strip():
        warnings.append("custom-nftables-present-review-docker-forwarding")
    docker_user = runner.run(("iptables", "-S", "DOCKER-USER"))
    if docker_user.returncode != 0:
        warnings.append("docker-user-chain-not-detected")
    return tuple(warnings)
