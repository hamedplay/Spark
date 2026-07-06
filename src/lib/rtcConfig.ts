import { supabase } from './supabase';

/**
 * Builds an RTCConfiguration from a flat key→value map read from system_config
 * (section = 'video_conference').
 *
 * Supported keys:
 *   turn_server              full TURN URL, e.g. "turn:host:3478" or "turns:host:5349"
 *   turn_username            TURN auth username
 *   turn_credential          TURN auth password
 *   stun_servers             comma-separated STUN URLs
 *   ice_transport_policy     "auto" | "p2p-first" | "all" | "relay" | "stun-only"
 *   enable_turn_fallback     "true" | "false" — include TURN in ICE servers when policy != relay
 *
 * Policy semantics:
 *   "p2p-first" — all transports; WebRTC naturally prefers host > srflx > relay
 *   "auto"      — same as p2p-first (always 'all')
 *   "all"       — same as p2p-first
 *   "relay"     — RTCIceTransportPolicy = 'relay', only TURN relay candidates used
 *   "stun-only" — 'all' transport policy but TURN servers are omitted from iceServers
 */

const IS_DEV = import.meta.env.DEV;
const log = {
  info:  (...a: unknown[]) => IS_DEV && console.info(...a),
  warn:  (...a: unknown[]) => IS_DEV && console.warn(...a),
  error: (...a: unknown[]) => console.error(...a), // errors always logged
};

// Public STUN fallback — used when DB and env both have no ICE servers configured.
// Also added alongside TURN so candidate gathering still succeeds when relay path is slow.
const FALLBACK_STUN: RTCIceServer = {
  urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'],
};

/**
 * Strip scheme and path/query from a raw TURN URL so we can reconstruct
 * controlled forms (UDP, TCP, TLS).
 *
 * Handles:
 *   turn:host:3478        → host:3478
 *   turns:host:5349       → host:5349
 *   turn://host:3478      → host:3478
 *   turns://host:5349/... → host:5349
 *   turn:host:3478?a=b    → host:3478
 */
function stripTurnScheme(raw: string): string {
  return raw
    .replace(/^turns?:\/\//i, '') // scheme with //
    .replace(/^turns?:/i, '')     // scheme without //
    .split('?')[0]                // query string
    .split('/')[0]                // path component
    .trim();
}

export function buildRTCConfigFromDB(cfg: Record<string, string>): RTCConfiguration {
  const turnServerUrl    = cfg['turn_server']?.trim()           || '';
  const username         = cfg['turn_username']?.trim()         || '';
  const credential       = cfg['turn_credential']?.trim()       || '';
  const stunServersStr   = cfg['stun_servers']?.trim()          || '';
  const policyKey        = cfg['ice_transport_policy']?.trim()  || 'auto';
  const turnFallback     = cfg['enable_turn_fallback']?.trim()  !== 'false'; // default true

  const isStunOnly = policyKey === 'stun-only';
  const hasTurnCreds = !!(turnServerUrl && username && credential);

  log.info(
    `[RTCConfig] buildRTCConfigFromDB policyKey=${policyKey} isStunOnly=${isStunOnly}` +
    ` turnPresent=${hasTurnCreds} turnFallback=${turnFallback}` +
    ` stunServers="${stunServersStr || '(none)'}"`
  );

  const iceServers: RTCIceServer[] = [];

  if (stunServersStr) {
    const urls = stunServersStr.split(',').map(s => s.trim()).filter(Boolean);
    if (urls.length) iceServers.push({ urls });
  }

  // Include TURN only when the policy allows it and turn_fallback is enabled
  if (!isStunOnly && turnFallback && turnServerUrl && username && credential) {
    const bare = stripTurnScheme(turnServerUrl);
    iceServers.push({
      urls: [
        `turn:${bare}?transport=udp`,
        `turn:${bare}?transport=tcp`,
        `turns:${bare}`,
      ],
      username,
      credential,
    });
    log.info(`[RTCConfig] TURN server added bare=${bare} (udp+tcp+tls)`);
  } else if (hasTurnCreds && (isStunOnly || !turnFallback)) {
    log.warn(`[RTCConfig] TURN creds present but OMITTED — isStunOnly=${isStunOnly} turnFallback=${turnFallback}`);
  } else if (!hasTurnCreds) {
    log.warn('[RTCConfig] No TURN credentials configured — relay path unavailable (may fail behind strict NAT/firewall)');
  }

  const hasStun = iceServers.some(s =>
    (Array.isArray(s.urls) ? s.urls : [s.urls as string]).some(u => /^stun:/i.test(u))
  );

  // Always keep at least one STUN server for host+srflx candidate gathering
  if (!hasStun) {
    iceServers.unshift(FALLBACK_STUN);
    log.info('[RTCConfig] No STUN configured — added public Google STUN fallback');
  }

  let iceTransportPolicy: RTCIceTransportPolicy;
  switch (policyKey) {
    case 'relay':
      iceTransportPolicy = 'relay';
      break;
    // stun-only, p2p-first, all, auto — all use 'all' transport policy.
    // The distinction is in which iceServers are included (stun-only omits TURN above).
    // WebRTC naturally tries host candidates first, then srflx, then relay.
    default:
      iceTransportPolicy = 'all';
  }

  const turnCount = iceServers.filter(s =>
    (Array.isArray(s.urls) ? s.urls : [s.urls as string]).some(u => /^turns?:/i.test(u))
  ).length;
  const stunCount = iceServers.filter(s =>
    (Array.isArray(s.urls) ? s.urls : [s.urls as string]).some(u => /^stun:/i.test(u))
  ).length;

  log.info(
    `[RTCConfig] final iceServers=${iceServers.length} (stun=${stunCount} turn=${turnCount})` +
    ` iceTransportPolicy=${iceTransportPolicy}`
  );

  return {
    iceServers,
    iceCandidatePoolSize: 2,
    iceTransportPolicy,
    bundlePolicy: 'max-bundle',
    rtcpMuxPolicy: 'require',
  };
}

// Last-resort fallback: read legacy env vars so local-dev setups still work
function buildEnvFallbackConfig(): RTCConfiguration {
  const host       = import.meta.env.VITE_TURN_HOST;
  const username   = import.meta.env.VITE_TURN_USERNAME;
  const credential = import.meta.env.VITE_TURN_PASSWORD;

  const iceServers: RTCIceServer[] = [FALLBACK_STUN];

  if (host && username && credential) {
    iceServers.push({
      urls: [
        `turn:${host}:3478?transport=udp`,
        `turn:${host}:3478?transport=tcp`,
        `turns:${host}:5349`,
      ],
      username,
      credential,
    });
    log.info(`[RTCConfig] env fallback: TURN host=${host}`);
  } else {
    log.warn('[RTCConfig] env fallback: no TURN env vars (VITE_TURN_HOST/USERNAME/PASSWORD) — STUN only');
  }

  return {
    iceServers,
    iceCandidatePoolSize: 2,
    iceTransportPolicy: 'all',
    bundlePolicy: 'max-bundle',
    rtcpMuxPolicy: 'require',
  };
}

// ── Singleton Promise cache ───────────────────────────────────────────────────
// One network round-trip per page load; result shared by all callers.
let _configPromise: Promise<RTCConfiguration> | null = null;

export function getSharedRTCConfig(): Promise<RTCConfiguration> {
  if (!_configPromise) {
    log.info('[RTCConfig] getSharedRTCConfig: cache MISS — fetching from system_config');

    const timeout = new Promise<RTCConfiguration>((_, reject) =>
      setTimeout(() => reject(new Error('RTC config fetch timeout')), 5000)
    );

    const dbFetch = supabase
      .from('system_config')
      .select('key,value')
      .eq('section', 'video_conference')
      .then(({ data }) => {
        if (!data || data.length === 0) {
          log.warn('[RTCConfig] system_config returned no rows — using env fallback');
          return buildEnvFallbackConfig();
        }
        const cfg = Object.fromEntries(
          data.map((r: { key: string; value: string | null }) => [r.key, r.value ?? ''])
        );
        return buildRTCConfigFromDB(cfg);
      });

    _configPromise = Promise.race([dbFetch, timeout])
      .catch((err) => {
        log.error('[RTCConfig] DB fetch failed or timed out — using env fallback:', err);
        return buildEnvFallbackConfig();
      });
  } else {
    log.info('[RTCConfig] getSharedRTCConfig: cache HIT');
  }
  return _configPromise;
}

/** Call this after the admin saves video_conference settings to pick up the new values. */
export function invalidateRTCConfigCache(): void {
  log.info('[RTCConfig] cache invalidated — next call will re-fetch from DB');
  _configPromise = null;
}
