import assert from 'node:assert/strict';
import {
  existsSync,
  readFileSync,
} from 'node:fs';
import { test } from 'node:test';

const read = (path) =>
  readFileSync(new URL('../../' + path, import.meta.url), 'utf8');

const compose = read('deploy/livekit/docker-compose.yml');
const env = read('deploy/livekit/.env.example');
const redis = read('deploy/livekit/redis.conf');
const caddy = read('deploy/livekit/Caddyfile');
const livekitYaml = read('deploy/livekit/livekit.yaml');
const egressYaml = read('deploy/livekit/egress.yaml');
const ingressYaml = read('deploy/livekit/ingress.yaml');
const manager = read('deploy/spark-cli/lib/install-livekit.sh');
const gitignore = read('.gitignore');

test('Phase 23 keeps the requested single-node production topology', () => {
  for (const service of [
    'minio:',
    'redis:',
    'livekit:',
    'egress:',
    'ingress:',
    'caddy:',
  ]) {
    assert.match(
      compose,
      new RegExp('\\n  ' + service.replace(':', '\\:')),
    );
  }

  assert.match(compose, /max_participants:\s*20/);
  assert.match(compose, /network_mode:\s*host/);
});

test('Redis remains private and protected by default', () => {
  assert.match(redis, /^bind 127\.0\.0\.1$/m);
  assert.match(redis, /^protected-mode yes$/m);
  assert.match(redis, /^port 6379$/m);
  assert.doesNotMatch(redis, /^bind 0\.0\.0\.0$/m);
});

test('Redis address is externalizable without changing media service source', () => {
  assert.match(env, /LIVEKIT_REDIS_ADDRESS=127\.0\.0\.1:6379/);

  for (const config of [
    compose,
    livekitYaml,
    egressYaml,
    ingressYaml,
  ]) {
    assert.match(config, /LIVEKIT_REDIS_ADDRESS/);
  }
});

test('core runtime services have Docker health checks', () => {
  const sections = {
    minio: /minio:[\s\S]*?healthcheck:[\s\S]*?minio\/health\/ready/,
    redis: /redis:[\s\S]*?healthcheck:[\s\S]*?redis-cli/,
    livekit: /livekit:[\s\S]*?healthcheck:[\s\S]*?127\.0\.0\.1:7880/,
    egress: /egress:[\s\S]*?healthcheck:[\s\S]*?127\.0\.0\.1:9091/,
    ingress: /ingress:[\s\S]*?healthcheck:[\s\S]*?127\.0\.0\.1:9092/,
  };

  for (const [name, pattern] of Object.entries(sections)) {
    assert.match(compose, pattern, name);
  }
});

test('startup ordering waits on healthy stateful dependencies', () => {
  assert.match(
    compose,
    /minio-init:[\s\S]*?minio:[\s\S]*?condition:\s*service_healthy/,
  );
  assert.match(
    compose,
    /livekit:[\s\S]*?redis:[\s\S]*?condition:\s*service_healthy/,
  );
  assert.match(
    compose,
    /egress:[\s\S]*?redis:[\s\S]*?condition:\s*service_healthy[\s\S]*?livekit:[\s\S]*?condition:\s*service_healthy[\s\S]*?minio:[\s\S]*?condition:\s*service_healthy/,
  );
  assert.match(
    compose,
    /ingress:[\s\S]*?redis:[\s\S]*?condition:\s*service_healthy[\s\S]*?livekit:[\s\S]*?condition:\s*service_healthy/,
  );
});

test('long-running services have explicit restart policies', () => {
  for (const name of [
    'minio',
    'redis',
    'livekit',
    'egress',
    'ingress',
    'caddy',
    'prometheus',
    'alertmanager',
    'loki',
    'alloy',
    'node-exporter',
    'blackbox-exporter',
    'grafana',
  ]) {
    const section = compose.match(
      new RegExp(
        '\\n  ' + name.replace('-', '\\-')
        + ':[\\s\\S]*?(?=\\n  [a-zA-Z0-9_-]+:|\\nvolumes:)',
      ),
    )?.[0] || '';
    assert.match(section, /restart:\s*unless-stopped/, name);
  }

  assert.match(
    compose,
    /minio-init:[\s\S]*?restart:\s*"no"/,
  );
});

test('core media and state services have explicit resource ceilings', () => {
  for (const name of [
    'minio',
    'redis',
    'livekit',
    'egress',
    'ingress',
    'caddy',
  ]) {
    const section = compose.match(
      new RegExp(
        '\\n  ' + name
        + ':[\\s\\S]*?(?=\\n  [a-zA-Z0-9_-]+:|\\nvolumes:)',
      ),
    )?.[0] || '';

    assert.match(section, /cpus:/, name);
    assert.match(section, /mem_limit:/, name);
    assert.match(section, /pids_limit:/, name);
  }

  assert.match(compose, /LIVEKIT_CPU_LIMIT/);
  assert.match(compose, /LIVEKIT_MEMORY_LIMIT/);
  assert.match(compose, /EGRESS_CPU_LIMIT/);
  assert.match(compose, /EGRESS_MEMORY_LIMIT/);
});

test('LiveKit graceful shutdown budget is explicit and operator-tunable', () => {
  assert.match(
    compose,
    /stop_grace_period:\s*\$\{LIVEKIT_STOP_GRACE_PERIOD:-5h\}/,
  );
  assert.match(env, /LIVEKIT_STOP_GRACE_PERIOD=5h/);
});

test('internal LiveKit API stays behind the TLS reverse proxy', () => {
  assert.match(
    caddy,
    /reverse_proxy\s+127\.0\.0\.1:7880/,
  );
  assert.match(
    manager,
    /LIVEKIT_INTERNAL_API_PORT="7880"/,
  );
  assert.match(
    manager,
    /ufw deny "\$\{LIVEKIT_INTERNAL_API_PORT\}\/tcp"/,
  );
  assert.match(
    manager,
    /livekit_internal_api_exposure_probe/,
  );
  assert.match(
    manager,
    /Default: deny \\(incoming\\\)/,
  );
  assert.match(
    manager,
    /127\.0\.0\.1:\$\{LIVEKIT_INTERNAL_API_PORT\}/,
  );
  assert.doesNotMatch(
    manager,
    /ufw allow "\$\{LIVEKIT_INTERNAL_API_PORT\}\/tcp"/,
  );
});

test('media ports remain explicitly separated from the internal API port', () => {
  assert.match(manager, /LIVEKIT_ICE_TCP_PORT="7881"/);
  assert.match(manager, /LIVEKIT_RTC_MIN_PORT="50000"/);
  assert.match(manager, /LIVEKIT_RTC_MAX_PORT="60000"/);
  assert.match(manager, /LIVEKIT_TURN_UDP_PORT="443"/);
  assert.match(manager, /LIVEKIT_TURN_TLS_PORT="5349"/);
  assert.match(manager, /LIVEKIT_RTMP_PORT="1935"/);
  assert.match(manager, /LIVEKIT_WHIP_UDP_PORT="7885"/);
});

test('secret files remain root-owned deployment state and real env is ignored', () => {
  assert.match(env, /LIVEKIT_API_SECRET=replace-with-long-random-api-secret/);
  assert.match(env, /S3_SECRET_KEY=replace-me/);
  assert.match(env, /GRAFANA_ADMIN_PASSWORD=replace-me/);
  assert.match(gitignore, /^\.env$/m);
  assert.equal(
    existsSync(new URL('../../deploy/livekit/.env', import.meta.url)),
    false,
  );
  assert.match(
    manager,
    /stat -c '%a' "\$LIVEKIT_ENV"\) == "600"/,
  );
  assert.match(
    manager,
    /livekit_secret_file_permissions_probe/,
  );
});

test('Spark Manager uses core service state independently from observability profile state', () => {
  assert.match(
    manager,
    /livekit_runtime_ready\(\)[\s\S]*?state="\$\(livekit_service_state "\$service"/,
  );
  assert.match(
    manager,
    /livekit_observability_ready\(\)[\s\S]*?state="\$\(livekit_observability_service_state "\$service"/,
  );
});

test('cleanup removes the explicit internal API deny rule', () => {
  assert.match(
    manager,
    /ufw --force delete deny 7880\/tcp/,
  );
});
