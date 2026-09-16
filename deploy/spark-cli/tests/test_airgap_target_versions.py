"""Target-version selection and safe package transaction regression tests."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
import test_airgap_image_identity as identity

CLI = Path(__file__).resolve().parents[1]


class TargetVersionTests(unittest.TestCase):
    run_shell = identity.AirgapIdentityTests.run_shell

    def test_point_release_normalization_and_invalid_targets(self):
        self.run_shell(r'''
[[ "$(airgap_normalize_ubuntu_release 26.04.1)" == 26.04 ]]
[[ "$(airgap_normalize_ubuntu_release 24.04.3)" == 24.04 ]]
[[ "$(airgap_normalize_ubuntu_release 26.04)" == 26.04 ]]
for value in 26.04.bad 26.10 22.04 ''; do
  if airgap_normalize_ubuntu_release "$value"; then exit 1; fi
done
''')

    def test_builder_default_is_destination_not_host_release(self):
        self.run_shell(r'''
make_repos
airgap_prompt_default() {
  case "$1" in
    target_release) [[ "$3" == 26.04 ]]; printf -v "$1" '%s' '26.04.1' ;;
    output_root) printf -v "$1" '%s' "$WORK/output" ;;
    *) return 1 ;;
  esac
}
airgap_build_bundle </dev/null
archive=("$WORK/output/"*.tar.gz)
[[ "${archive[0]}" == *ubuntu26.04-amd64* ]]
''')

    def test_bundle_platform_metadata_cannot_disagree(self):
        self.run_shell(r'''
make_repos
airgap_build_bundle </dev/null
mkdir "$WORK/extracted"
archive=("$WORK/output/"*.tar.gz)
root="$(airgap_extract_bundle_archive "${archive[0]}" "$WORK/extracted")"
printf 'UBUNTU_VERSION=24.04\nARCH=amd64\n' >"$root/apt/platform.env"
if airgap_validate_payload_archives "$root"; then exit 1; fi
''')

    def run_installer(self, installed, fail_simulation=False):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            payload = root / 'payload'; payload.mkdir()
            package = root / 'pkg/DEBIAN'; package.mkdir(parents=True)
            (package / 'control').write_text('Package: spark-version-fixture\nVersion: 1.28.3-2ubuntu1.11\nArchitecture: all\nMaintainer: Test <t@example.invalid>\nDescription: fixture\n')
            deb = payload / 'fixture.deb'
            subprocess.run(['dpkg-deb', '--build', str(package.parent), str(deb)], check=True, capture_output=True)
            bin_dir = root / 'bin'; bin_dir.mkdir()
            (bin_dir / 'dpkg-query').write_text('#!/bin/bash\nprintf "install ok installed\\t%s" "$INSTALLED"\n')
            (bin_dir / 'apt-get').write_text('#!/bin/bash\nprintf "%s\\n" "$*" >>"$CALLS"\nif [[ "$*" == *--simulate* && "$FAIL_SIMULATION" == 1 ]]; then exit 9; fi\n')
            for p in bin_dir.iterdir(): p.chmod(0o755)
            log = root / 'calls'
            env = {**os.environ, 'PATH': str(bin_dir) + ':' + os.environ['PATH'], 'INSTALLED': installed, 'CALLS': str(log), 'FAIL_SIMULATION': str(int(fail_simulation))}
            result = subprocess.run(['bash', str(CLI / 'lib/airgap-packages.sh'), str(payload)], env=env, capture_output=True, text=True, timeout=15)
            return result, log.read_text().splitlines() if log.exists() else []

    def test_newer_installed_security_revision_is_preserved(self):
        result, calls = self.run_installer('1.28.3-2ubuntu1.12')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(calls, [])
        self.assertIn('Preserving newer', result.stdout)

    def test_older_version_is_resolved_then_installed_without_removal(self):
        result, calls = self.run_installer('1.28.3-2ubuntu1.10')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(len(calls), 2)
        self.assertIn('--simulate', calls[0])
        self.assertNotIn('--simulate', calls[1])
        for call in calls:
            self.assertIn('--no-remove', call)
            self.assertNotIn('--allow-downgrades', call)
            self.assertIn('Dir::Etc::sourcelist=', call)

    def test_dependency_conflict_does_not_run_install(self):
        result, calls = self.run_installer('1.24.0-2ubuntu7', fail_simulation=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(len(calls), 1)
        self.assertIn('--simulate', calls[0])


if __name__ == '__main__':
    unittest.main()
