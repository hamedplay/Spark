# Spark Installation Air-Gapped — internal IPv4

This workflow installs Spark on Ubuntu 24.04 or 26.04 **amd64**, using a matching bundle prepared on a connected staging host. The target needs no Internet, domain, DNS record, public IP, ACME request or TLS certificate. The normal online Installation menu is unchanged.

## Prepare and transfer

On the connected host, update Spark Manager/source and use **Installation Air-Gapped → Build complete offline bundle**. The builder synchronizes clean Spark `main`; the existing Supabase source must be pinned to a tested stable `self-hosted/vX.Y.Z` tag and agree with any installed runtime. Select the target Ubuntu release and output directory.

The bundle includes:

- Exact Spark and stable Supabase Git snapshots with commit identities.
- Local Ubuntu packages and their dependency closure: Docker CE/Compose/Buildx, Node 24, Nginx, Coturn, Python/YAML, systemd/socket proxy, IP/socket tools, Git and supporting utilities.
- npm 11 and target-matched frontend node_modules.
- Supabase, prebuilt Avatar Worker, LiveKit/Redis/Egress/Ingress/MinIO and observability Docker images with checked linux/amd64 identities.
- All Edge Function sources, the main router, and DENO_DIR cached with the exact embedded Deno version.
- Self-contained `bootstrap.sh`, metadata and checksums.

The builder proves local package installation and frontend build in a container with **networking disabled**, and separately verifies every function dependency graph without networking. A failed proof prevents bundle publication. Builder configuration, private certificates, and application database contents are **not exported**.

Transfer the archive and `.sha256` sidecar. On the bank server (replace the example name with the actual filename):

```bash
cd /opt/install
sha256sum -c spark-airgap-EXAMPLE.tar.gz.sha256
tar -xzf spark-airgap-EXAMPLE.tar.gz
sudo bash /opt/install/spark-airgap-EXAMPLE/bootstrap.sh
```

Bootstrap validates platform/checksums, installs local packages with external APT sources disabled, restores the bundled manager/source, and imports/activates local images. Keep the extracted bundle outside `/opt/spark`.

## Complete and individual installation

Open `spark` → **Installation Air-Gapped** → **Run complete offline installation**. **Run one offline install step** lists the same ordered plan. Both use the same bundle preflight and execution function; failures stop the chain and remove the failed step's success marker.

There are **21 steps**. Original IDs are retained for existing logs and runbooks: **1–17, 19–22**. Step 18 (firewall) is removed and rejected if entered manually. The offline workflow does not enable, reset, add or remove host firewall rules, including the Gateway, database and LiveKit helpers. Network policy remains managed by the bank.

| IDs | Offline operation |
| --- | --- |
| 1 | Choose an IPv4 assigned to the server and TURN relay range |
| 2 | Install local packages/npm and check required executables/services |
| 3–4 | Restore exact local Git snapshots; validate Supabase runtime provenance |
| 5–6 | Generate/preserve target secrets and configure IP-based HTTP URLs |
| 7–9 | Install function sources, provider/worker settings and hardened Compose |
| 10 | Start Supabase, check database credentials, seed DENO_DIR and cold-load a function; bind API/database to selected IP |
| 11–12 | Restore local node_modules, build/deploy frontend and configure HTTP Nginx |
| 13–14 | Validate/configure HTTP origin, without requesting certificates |
| 15–17 | Configure local schedulers/TURN and disable certificate renewal |
| 19–20 | Configure/start local LiveKit and media dependencies without TLS |
| 21 | Verify Spark application database (or offer local Restore), workers and function guards |
| 22 | Start and verify local observability |

Docker Compose `up/create` use `--pull never --no-build`; `run` uses `--pull never`. Target Docker pulls/builds are rejected. npm is offline, and frontend `npm ci` restores the transferred modules. Missing artifacts fail locally instead of falling back to registry downloads. This constrains installer operations; it is not an OS network sandbox.

## Application database is required

The repository does **not** contain baseline migrations to recreate the complete Spark application database. A blank Supabase installation alone cannot run Spark.

Transfer a compatible **plain SQL Spark database backup** separately using the existing Backup workflow. Keep it protected: a full database backup can contain users and business data. Step 21 preserves an already provisioned database. If application tables are absent, it offers the existing local Restore flow, shows the replacement action and requires typing `RESTORE`. The existing restore creates a safety backup and attempts rollback on failure. It then resynchronizes target service credentials, validates the runtime, and checks application/worker contracts. A wrong/incomplete database fails installation; it is never silently treated as ready. Storage object files must be transferred separately if needed; they are not contained in a PostgreSQL dump.

After fixing a failed step, rerun it with `spark-airgap --step NUMBER`, then execute the remaining IDs in order. Complete installation replays the plan; it does not blindly trust historical success markers. A new application revision or dependency set requires a newly built matching bundle.

## Access and runtime limits

| Service | Endpoint |
| --- | --- |
| Spark web and same-origin API | `http://SERVER_IP/` |
| Direct Supabase gateway | `http://SERVER_IP:8000/` |
| PostgreSQL via Supavisor session | `SERVER_IP:5432` |
| LiveKit signaling | `ws://SERVER_IP:7880` |

The bank network must permit the required traffic. Media uses configured TURN/RTC ports (by default LiveKit UDP 443, TCP 7881 and UDP 50000–60000; ingress TCP 1935/UDP 7885). This installer leaves existing firewall policy untouched and tests actual listeners/protocol reachability.

HTTP on an ordinary LAN IP is not a browser secure context. Camera/microphone, screen sharing and service-worker/PWA capabilities may be unavailable even when all server checks pass. HTTPS or an explicitly managed browser policy is needed for those browser features; neither is an offline installation prerequisite. See [browser getUserMedia requirements](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia).

SMS, email, external identity providers and external APIs remain runtime integrations: their services must be reachable through approved internal gateways if those features are used. An offline bundle cannot turn an external provider into a local service. Local IP/HTTP Supabase configuration follows the [self-hosting documentation](https://supabase.com/docs/guides/self-hosting/docker).

## Building on Ubuntu 24.04 for a 26.04 bank server

Builder and target do not need matching Ubuntu or Nginx versions. Select the **destination** release: `26.04` for Ubuntu `26.04.1`. The prompt now defaults to 26.04 independently of the builder host; point-release input is normalized. Docker fetches fresh target Ubuntu images, and APT resolves current package candidates from the target Ubuntu repositories (plus the existing Docker/Node repositories). Host Nginx is neither copied nor upgraded. The complete distro package version, including Ubuntu security revision, is recorded in `apt/package-versions.tsv`; `nginx -v` alone does not show that revision.

New bundles include `apt/platform.env` and a standalone local installer. Before modifying packages, it preserves newer installed versions and simulates dependency resolution with external sources disabled. Installation refuses removals and unapproved downgrades. If preserved newer libraries are incompatible with exact dependencies in an older bundle, installation stops; refresh the matching-target bundle instead of forcing a downgrade. Legacy bootstrap fallbacks also refuse removals/downgrades.

An existing `ubuntu24.04` bundle is not a 26.04 bundle, regardless of the host on which it was built. Inspect `UBUNTU_VERSION` in `metadata/manifest.env`. Build a new 26.04 bundle with the current manager to include current installer fixes. Alternatively, for a compatible existing bundle, build a target patch on the connected host:

```bash
spark-airgap --build-target-patch /path/to/base-bundle.tar.gz 26.04 /var/backups/spark-airgap
```

A target patch regenerates both APT and frontend/npm payloads and repeats the disconnected proof; it reuses the exact application/source/Docker/Edge payload. It does **not** upgrade the application or the manager embedded in an old Git bundle. Do not edit the Ubuntu field manually or transfer only the Nginx .deb.
