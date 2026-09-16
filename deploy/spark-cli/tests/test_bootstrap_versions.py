"""Execute bootstrap version gates against the repository's component versions."""
import os
from pathlib import Path
import re
import subprocess
import tempfile
import unittest

CLI = Path(__file__).resolve().parents[1]


def version(name):
    return re.search(r'^SPARK_MANAGER_VERSION="([^"]+)"', (CLI / name).read_text(), re.M)[1]


class BootstrapVersionTests(unittest.TestCase):
    def run_gate(self, source, script, airgap=None):
        with tempfile.TemporaryDirectory() as work:
            root = Path(work)
            for name, label in [('spark', 'Spark Server Manager'), ('spark-airgap', 'Spark Air-Gapped Installer')]:
                value = airgap if name == 'spark-airgap' and airgap else version(name)
                (root / name).write_text(f'#!/bin/bash\nSPARK_MANAGER_VERSION="{value}"\nprintf "%s\\n" "{label} $SPARK_MANAGER_VERSION"\n')
                (root / name).chmod(0o755)
            for name in ('lib/airgap-auto.sh', 'lib/airgap-edge-functions.sh', 'bootstrap-airgap.sh', 'spark-migrate'):
                path = root / name; path.parent.mkdir(parents=True, exist_ok=True); path.touch(); path.chmod(0o755)
            constants = '\n'.join(line for line in source.splitlines() if re.match(r'^EXPECTED_[A-Z_]+=', line))
            setup = 'set -eu\n' + constants + '\nrollback_install() { echo rollback >&2; }\n'
            env = {**os.environ, 'tmp': work, 'TARGET': work, 'CLI_PATH': str(root/'spark'), 'AIRGAP_CLI_PATH': str(root/'spark-airgap'), 'MIGRATE_PATH': str(root/'spark-migrate')}
            return subprocess.run(['bash', '-c', setup + script], env=env, capture_output=True, text=True, timeout=10)

    def test_downloaded_versions_accept_current_and_reject_stale(self):
        source = (CLI / 'bootstrap.sh').read_text()
        start = source.index('grep -Fq "SPARK_MANAGER_VERSION=')
        end = source.index("grep -q 'airgap-build-target-patch'", start)
        script = source[start:end]
        current = self.run_gate(source, script)
        self.assertEqual(current.returncode, 0, current.stderr)
        stale = self.run_gate(source, script, '3.1.0+20260910.1')
        self.assertNotEqual(stale.returncode, 0)
        self.assertIn('Air-Gap backend version validation failed', stale.stderr)

    def test_installed_version_smoke_checks_and_rollback(self):
        source = (CLI / 'bootstrap.sh').read_text()
        start = source.index('if ! version_output=')
        end = source.index('if ! migrate_version_output=', start)
        script = source[start:end]
        current = self.run_gate(source, script)
        self.assertEqual(current.returncode, 0, current.stderr)
        stale = self.run_gate(source, script, '3.1.0+20260910.1')
        self.assertNotEqual(stale.returncode, 0)
        self.assertIn('rollback', stale.stderr)

    def test_offline_bootstrap_preserves_current_component_pair(self):
        source = (CLI / 'bootstrap-airgap.sh').read_text()
        start = source.index('preserve_control_plane=0')
        end = source.index('\nwork=""', start)
        script = source[start:end] + '\nprintf "%s" "$preserve_control_plane"\n'
        current = self.run_gate(source, script)
        self.assertEqual(current.returncode, 0, current.stderr)
        self.assertEqual(current.stdout, '1')
        stale = self.run_gate(source, script, '3.1.0+20260910.1')
        self.assertEqual(stale.stdout, '0')


if __name__ == '__main__':
    unittest.main()
