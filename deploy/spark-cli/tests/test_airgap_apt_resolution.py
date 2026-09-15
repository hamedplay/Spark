"""Real APT regression for installed reverse dependencies; no host changes.

Uses a file:// repository, isolated APT/dpkg state, and simulation for target
installation. Only synthetic .deb files are downloaded into a temporary cache.
"""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


@unittest.skipUnless(all(shutil.which(c) for c in ('apt-get', 'dpkg-deb', 'dpkg-query', 'dpkg-scanpackages')), 'APT tools required')
class AptResolutionTests(unittest.TestCase):
    def test_installed_reverse_dependency_is_shipped_at_matching_version(self):
        with tempfile.TemporaryDirectory(prefix='spark-apt-resolution-') as directory:
            root = Path(directory)
            repo = root / 'repo'
            repo.mkdir()
            records = {}
            for package, version, dependency in (
                ('spark-test-lib', '1', ''), ('spark-test-lib', '2', ''),
                ('spark-test-base', '1', 'Pre-Depends: spark-test-lib (= 1)\n'),
                ('spark-test-base', '2', 'Pre-Depends: spark-test-lib (= 2)\n'),
                ('spark-test-app', '1', 'Depends: spark-test-lib (= 2)\n'),
            ):
                control = (f'Package: {package}\nVersion: {version}\nArchitecture: all\n'
                           'Maintainer: Test <test@example.invalid>\nDescription: isolated APT fixture\n' + dependency
                           + ('Essential: yes\n' if package == 'spark-test-base' else ''))
                records[package, version] = control
                build = root / f'{package}-{version}' / 'DEBIAN'
                build.mkdir(parents=True)
                (build / 'control').write_text(control)
                subprocess.run(['dpkg-deb', '--build', str(build.parent), str(repo / f'{package}_{version}_all.deb')], check=True, capture_output=True)
            index = subprocess.run(['dpkg-scanpackages', '--multiversion', '.', '/dev/null'], cwd=repo, check=True, capture_output=True)
            (repo / 'Packages').write_bytes(index.stdout)
            (root / 'sources.list').write_text(f'deb [trusted=yes] file:{repo} ./\n')
            for name in ('lists/partial', 'cache/archives/partial', 'dpkg', 'empty-sources', 'empty-parts'):
                (root / name).mkdir(parents=True, exist_ok=True)
            status = ''.join(records[p, '1'] + 'Status: install ok installed\n\n' for p in ('spark-test-lib', 'spark-test-base'))
            (root / 'dpkg/status').write_text(status)
            (root / 'empty-status').touch()
            (root / 'empty.list').touch()
            config = [
                '-o', f'Dir::Etc::sourcelist={root}/sources.list',
                '-o', f'Dir::Etc::sourceparts={root}/empty-sources',
                '-o', f'Dir::Etc::parts={root}/empty-parts',
                '-o', 'Dir::Etc::main=/dev/null',
                '-o', f'Dir::State={root}',
                '-o', f'Dir::State::lists={root}/lists',
                '-o', f'Dir::State::status={root}/empty-status',
                '-o', f'Dir::Cache={root}/cache',
                '-o', f'Dir::Log={root}/log',
                '-o', 'APT::Sandbox::User=' + str(os.getuid()),
                '-o', 'Debug::NoLocking=1',
                '-o', 'APT::Get::List-Cleanup=0',
            ]
            # APT_CONFIG prevents reading host hooks/config; all mutable paths
            # are redirected and no real package installation is performed.
            cfg = root / 'apt.conf'
            cfg.write_text(f'Dir::Etc::parts "{root}/empty-parts";\nDir::Etc::main "/dev/null";\n')
            env = {**os.environ, 'APT_CONFIG': str(cfg), 'WORK': str(root)}
            def apt(*args, success=True):
                result = subprocess.run(['apt-get', *config, *args], env=env, text=True, capture_output=True, timeout=30)
                if success:
                    self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                else:
                    self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
                return result
            apt('update')
            # Old empty-status strategy ships app+lib2 but omits installed base1.
            selected = apt('install', '-y', '--download-only', '--reinstall', 'spark-test-app')
            self.assertNotIn('spark-test-base', selected.stdout)
            # file:// downloads can use original paths without copying into
            # archives/, so replay the selected fixture files directly.
            old_payload = [str(repo / p) for p in ('spark-test-app_1_all.deb', 'spark-test-lib_2_all.deb')]
            result = apt('-s', '-o', f'Dir::Etc::sourcelist={root}/empty.list',
                         '-o', f'Dir::State::status={root}/dpkg/status',
                         'install', *old_payload, success=False)
            self.assertIn('spark-test-base', result.stdout + result.stderr)
            # Execute the actual builder's base query and resolution command.
            builder = (Path(__file__).resolve().parents[1] / 'lib/airgap-build.sh').read_text()
            query = builder[builder.index('mapfile -t base_packages'):builder.index(': >/tmp/spark-empty-dpkg-status')]
            start = builder.index('apt-get -o Dir::State::status=/tmp/spark-empty-dpkg-status')
            resolve = builder[start:builder.index('\nmkdir -p /payload', start)]
            import shlex
            config_args = ' '.join(shlex.quote(v) for v in config)
            script = ("set -Eeuo pipefail\npackages=(spark-test-app)\n"
                      'dpkg-query() { command dpkg-query --admindir="$WORK/dpkg" "$@"; }\n'
                      f'apt-get() {{ command apt-get "$@" {config_args}; }}\n' + query + resolve)
            result = subprocess.run(['bash', '-c', script], env=env, text=True, capture_output=True, timeout=30)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertIn('spark-test-base', result.stdout)
            fixed_payload = [*old_payload, str(repo / 'spark-test-base_2_all.deb')]
            result = apt('-s', '-o', f'Dir::Etc::sourcelist={root}/empty.list',
                         '-o', f'Dir::State::status={root}/dpkg/status', 'install', *fixed_payload)
            self.assertIn('spark-test-base', result.stdout)


if __name__ == '__main__':
    unittest.main()
