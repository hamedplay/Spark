"""Exercise real APT archive acquisition and dpkg command planning safely."""
import os
import pwd
from pathlib import Path
import shlex
import shutil
import subprocess
import tempfile
import unittest


@unittest.skipUnless(shutil.which('apt-get') and shutil.which('dpkg-deb'), 'APT tools required')
class AptLocalPathTests(unittest.TestCase):
    def test_local_deb_path_is_resolved_without_no_download(self):
        with tempfile.TemporaryDirectory(prefix='spark-apt-path-') as directory:
            root = Path(directory)
            for folder in ('pkg/DEBIAN', 'lists/partial', 'cache/archives/partial', 'parts', 'sources', 'log'):
                (root / folder).mkdir(parents=True)
            (root / 'pkg/DEBIAN/control').write_text(
                'Package: spark-test-local\nVersion: 1\nArchitecture: all\n'
                'Maintainer: Test <test@example.invalid>\nDescription: local path fixture\n')
            deb = root / 'spark-test-local_1_all.deb'
            subprocess.run(['dpkg-deb', '--build', str(root / 'pkg'), str(deb)], check=True, capture_output=True)
            (root / 'status').touch()
            (root / 'sources.list').touch()
            config = root / 'apt.conf'
            config.write_text(f'Dir::Etc::parts "{root}/parts";\nDir::Etc::main "/dev/null";\n')
            # Debug::pkgDPkgPM prints the planned dpkg command instead of running
            # it. Also replace dpkg with a fail-closed stub as a second guard.
            dpkg = root / 'dpkg-guard'
            dpkg.write_text('#!/bin/sh\ncase "$1" in\n--print-foreign-architectures) exit 0;;\n--print-architecture) echo amd64; exit 0;;\n--assert-*) exit 0;;\nesac\nexit 77\n')
            dpkg.chmod(0o755)
            args = ['apt-get', '-y',
                    '-o', f'Dir::Etc::sourcelist={root}/sources.list',
                    '-o', f'Dir::Etc::sourceparts={root}/sources',
                    '-o', f'Dir::State={root}',
                    '-o', f'Dir::State::status={root}/status',
                    '-o', f'Dir::State::lists={root}/lists',
                    '-o', f'Dir::Cache={root}/cache',
                    '-o', f'Dir::Cache::archives={root}/cache/archives',
                    '-o', f'Dir::Log={root}/log',
                    '-o', f'Dir::Bin::dpkg={dpkg}',
                    '-o', 'Debug::pkgDPkgPM=1', '-o', 'Debug::NoLocking=1',
                    '-o', 'APT::Sandbox::User=' + pwd.getpwuid(os.getuid()).pw_name]
            env = {**os.environ, 'APT_CONFIG': str(config)}
            builder = (Path(__file__).resolve().parents[1] / 'lib/airgap-build.sh').read_text()
            start = builder.index('apt-get -o Dir::Etc::sourcelist=/tmp/empty-sources.list')
            command = builder[start:builder.index('\nwhile IFS=', start)].replace('\\\n', '')
            command = command.replace('/tmp/empty-sources.list', str(root / 'sources.list'))
            command = command.replace('/tmp/empty-sources', str(root / 'sources'))
            command = command.replace('/payload/apt/*.deb', str(deb))
            production = shlex.split(command)[1:]
            old = subprocess.run([*args, '--no-download', *production], env=env, text=True, capture_output=True, timeout=30)
            self.assertNotEqual(old.returncode, 0, old.stdout + old.stderr)
            self.assertIn('Pathname to install is not absolute', old.stdout + old.stderr)
            fixed = subprocess.run([*args, *production], env=env, text=True, capture_output=True, timeout=30)
            self.assertEqual(fixed.returncode, 0, fixed.stdout + fixed.stderr)
            self.assertIn(str(deb), fixed.stdout + fixed.stderr)


if __name__ == '__main__':
    unittest.main()
