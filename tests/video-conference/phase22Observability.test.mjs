import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) =>
  readFileSync(new URL('../../' + path, import.meta.url), 'utf8');

const compose = read('deploy/livekit/docker-compose.yml');
const env = read('deploy/livekit/.env.example');
const prometheus = read('deploy/livekit/monitoring/prometheus.yml');
const alerts = read('deploy/livekit/monitoring/rules/livekit-alerts.yml');
const alertmanager = read('deploy/livekit/monitoring/alertmanager.yml');
const loki = read('deploy/livekit/monitoring/loki.yml');
const alloy = read('deploy/livekit/monitoring/alloy.alloy');
const blackbox = read('deploy/livekit/monitoring/blackbox.yml');
const datasources = read(
  'deploy/livekit/monitoring/grafana/provisioning/datasources/datasources.yml',
);
const overview = read(
  'deploy/livekit/monitoring/grafana/dashboards/spark-livekit-overview.json',
);
const operations = read(
  'deploy/livekit/monitoring/grafana/dashboards/spark-livekit-operations.json',
);
const manager = read('deploy/spark-cli/lib/install-livekit.sh');

test('Phase 22 uses the requested self-hosted observability stack', () => {
  for (const service of [
    'prometheus:',
    'alertmanager:',
    'grafana:',
    'loki:',
    'alloy:',
    'node-exporter:',
    'blackbox-exporter:',
  ]) {
    assert.match(compose, new RegExp('\\n  ' + service.replace(':', '\\:')));
  }

  assert.match(compose, /profiles:\s*\n\s*- observability/g);
});

test('observability HTTP surfaces bind only to loopback', () => {
  for (const binding of [
    '127.0.0.1:9090',
    '127.0.0.1:9093',
    '127.0.0.1:12345',
    '127.0.0.1:9100',
    '127.0.0.1:9115',
  ]) {
    assert.match(compose, new RegExp(binding.replaceAll('.', '\\.')));
  }

  assert.match(loki, /http_listen_address:\s*127\.0\.0\.1/);
  assert.match(loki, /http_listen_port:\s*3100/);
  assert.match(compose, /GF_SERVER_HTTP_ADDR:\s*127\.0\.0\.1/);
  assert.match(compose, /GF_AUTH_ANONYMOUS_ENABLED:\s*"false"/);
  assert.doesNotMatch(compose, /ports:\s*\n\s*-\s*"?3000:3000/);
});

test('monitoring images are explicitly pinned', () => {
  for (const pin of [
    'PROMETHEUS_IMAGE=prom/prometheus:v3.14.0',
    'ALERTMANAGER_IMAGE=prom/alertmanager:v0.34.0',
    'GRAFANA_IMAGE=grafana/grafana:13.2.0',
    'LOKI_IMAGE=grafana/loki:3.7.0',
    'ALLOY_IMAGE=grafana/alloy:v1.19.0',
    'NODE_EXPORTER_IMAGE=prom/node-exporter:v1.12.1',
    'BLACKBOX_EXPORTER_IMAGE=prom/blackbox-exporter:v0.28.0',
  ]) {
    assert.match(env, new RegExp(pin.replaceAll('.', '\\.')));
  }
});

test('Prometheus scrapes LiveKit SFU Egress Ingress and host metrics', () => {
  for (const endpoint of [
    '127.0.0.1:6789',
    '127.0.0.1:6788',
    '127.0.0.1:6787',
    '127.0.0.1:9100',
    '127.0.0.1:9115',
    '127.0.0.1:12345',
    '127.0.0.1:3100',
  ]) {
    assert.match(prometheus, new RegExp(endpoint.replaceAll('.', '\\.')));
  }
  assert.match(prometheus, /file_sd_configs/);
  assert.match(prometheus, /blackbox\.json/);
});

test('recording rules cover throughput packet loss join failure and API health', () => {
  assert.match(alerts, /spark_livekit:network_in_bps/);
  assert.match(alerts, /spark_livekit:network_out_bps/);
  assert.match(alerts, /livekit_packet_loss_percent_bucket/);
  assert.match(alerts, /livekit_participant_join_total\{state="rtc_failure"\}/);
  assert.match(alerts, /probe_success\{job="blackbox-http"\}/);
  assert.match(alerts, /probe_duration_seconds\{job="blackbox-http",probe="spark-api"\}/);
});

test('Loki is single-node retained storage and Alloy collects Docker logs', () => {
  assert.match(loki, /replication_factor:\s*1/);
  assert.match(loki, /retention_period:\s*168h/);
  assert.match(loki, /reporting_enabled:\s*false/);
  assert.match(alloy, /discovery\.docker "containers"/);
  assert.match(alloy, /unix:\/\/\/var\/run\/docker\.sock/);
  assert.match(alloy, /loki\.source\.docker "containers"/);
  assert.match(alloy, /service/);
  assert.match(alloy, /http:\/\/127\.0\.0\.1:3100\/loki\/api\/v1\/push/);
});

test('Grafana is pre-provisioned with Prometheus Loki and Alertmanager', () => {
  assert.match(datasources, /uid:\s*prometheus/);
  assert.match(datasources, /uid:\s*loki/);
  assert.match(datasources, /uid:\s*alertmanager/);
  assert.match(datasources, /http:\/\/127\.0\.0\.1:9090/);
  assert.match(datasources, /http:\/\/127\.0\.0\.1:3100/);
  assert.match(datasources, /http:\/\/127\.0\.0\.1:9093/);
});

test('overview dashboard covers the Phase 22 metric inventory', () => {
  for (const signal of [
    'livekit_room_total',
    'livekit_participant_total',
    'process_cpu_seconds_total',
    'process_resident_memory_bytes',
    'spark_livekit:network_in_bps',
    'spark_livekit:network_out_bps',
    'spark_livekit:packet_loss_p95_percent',
    'livekit_connection_total',
    'spark_livekit:rtc_join_failures_5m',
    'probe_duration_seconds',
    'livekit_egress_available',
  ]) {
    assert.match(overview, new RegExp(signal.replaceAll('.', '\\.')));
  }
});

test('operations dashboard exposes reconnect ICE Egress and DB error signals from Loki', () => {
  assert.match(operations, /resuming RTC session/);
  assert.match(operations, /rtc_failure/);
  assert.match(operations, /service=\\"egress\\"/);
  assert.match(operations, /service=\\"db\\"/);
  assert.match(operations, /ERROR\|FATAL\|PANIC/);
});

test('blackbox probes require successful HTTPS', () => {
  assert.match(blackbox, /prober:\s*http/);
  assert.match(blackbox, /fail_if_not_ssl:\s*true/);
  assert.match(blackbox, /preferred_ip_protocol:\s*ip4/);
});

test('Spark Manager generates real targets and adds an isolated install step 22', () => {
  assert.match(manager, /livekit_write_observability_targets/);
  assert.match(manager, /https:\/\/\$\{API_DOMAIN\}\/auth\/v1\/health/);
  assert.match(manager, /"probe": "spark-api"/);
  assert.match(manager, /livekit_observability_ready/);
  assert.match(manager, /install_step_22\(\)/);
  assert.match(manager, /22\) printf 'LiveKit observability \/ dashboards \/ alerts'/);
  assert.match(manager, /for n in \$\(seq 1 22\)/);
});

test('manager verifies observability is loopback-only and backs up monitoring config', () => {
  assert.match(manager, /for port in 3000 9090 9093 3100 12345 9100 9115/);
  assert.match(manager, /0\\\.0\\\.0\\\.0/);
  assert.match(manager, /LIVEKIT_ROOT\}\/monitoring/);
  assert.match(manager, /STEP_DIR\}\/22\.ok/);
});

test('Alertmanager is provisioned locally without hard-coded external secrets', () => {
  assert.match(alertmanager, /receiver:\s*local-alerts/);
  assert.doesNotMatch(alertmanager, /webhook_configs:/);
  assert.doesNotMatch(alertmanager, /password:/);
  assert.doesNotMatch(alertmanager, /token:/);
});
