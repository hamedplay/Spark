from pathlib import Path

paths = [
    Path('deploy/spark-cli/lib/airgap-ip.sh'),
    Path('deploy/spark-cli/lib/install-platform-c.sh'),
]

for path in paths:
    text = path.read_text(encoding='utf-8')
    old = '  chmod 600 /etc/turnserver.conf\n'
    new = '  chown root:turnserver /etc/turnserver.conf\n  chmod 0640 /etc/turnserver.conf\n'
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected exactly one Coturn config chmod, found {count}')
    text = text.replace(old, new, 1)
    path.write_text(text, encoding='utf-8')

for path in paths:
    text = path.read_text(encoding='utf-8')
    assert 'chmod 600 /etc/turnserver.conf' not in text
    assert 'chown root:turnserver /etc/turnserver.conf' in text
    assert 'chmod 0640 /etc/turnserver.conf' in text

print('Coturn config ownership patch: PASS')
