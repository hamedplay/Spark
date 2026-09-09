# Spark Air-Gap Ubuntu Target Patch

Use this workflow when a large air-gap bundle was built for the wrong Ubuntu release and retransferring the Docker image payload would be expensive.

The target patch contains only release-dependent artifacts:

- `apt/` packages for the new Ubuntu release;
- `npm/` payload, including frontend `node_modules` built from the exact Spark commit embedded in the original bundle;
- patch metadata and SHA256 checksums.

It does **not** duplicate Docker images, Spark/Supabase Git bundles, certificates, or manager configuration.

## 1. Build the small patch on the connected staging host

Open:

```text
spark
→ Installation Air-Gapped
→ 07 Build Ubuntu target patch
```

Provide the path to the original large bundle and select the new target release, for example `26.04`.

The output defaults to `/var/backups/spark-airgap/` and is named similar to:

```text
spark-airgap-target-patch-<spark-commit>-ubuntu26.04-amd64-<timestamp>.tar.gz
spark-airgap-target-patch-<...>.tar.gz.sha256
```

The builder binds the patch to the original bundle ID and Spark commit, so it cannot be applied to an unrelated bundle.

## 2. Transfer only the target patch

Copy the small target-patch archive and its `.sha256` file to the isolated server. Keep the original large bundle already present there.

## 3. Apply the patch on the isolated target

Update Spark Manager from `main`, then open:

```text
spark
→ Installation Air-Gapped
→ 08 Apply Ubuntu target patch
```

Provide:

1. the path to the existing large bundle;
2. the path to the target patch.

Spark validates both payloads, verifies bundle ID / Spark commit / target OS / architecture, extracts the existing large bundle once, replaces only `apt/` and `npm/`, updates the manifest, and rebuilds `SHA256SUMS`.

The prepared result is stored under:

```text
/opt/spark-airgap/prepared/<retargeted-bundle-id>/
```

No second 5GB transfer and no new Docker image build is required.

## 4. Bootstrap directly from the prepared directory

`bootstrap-airgap.sh` accepts either a `.tar.gz` archive or an extracted/prepared bundle directory:

```bash
sudo bash /opt/spark/deploy/spark-cli/bootstrap-airgap.sh \
  /opt/spark-airgap/prepared/<retargeted-bundle-id>
```

The normal compatibility guard remains active. Do not edit `UBUNTU_VERSION` manually in `manifest.env`; the target patch exists specifically to replace the release-dependent package/npm payload before changing the target metadata.
