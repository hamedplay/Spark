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
  }

  const hasStun = iceServers.some(s =>
    (Array.isArray(s.urls) ? s.urls : [s.urls as string]).some(u => /^stun:/i.test(u))
  );

  // Always keep at least one STUN server for host+srflx candidate gathering
  if (!hasStun) iceServers.unshift(FALLBACK_STUN);

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

  return {
    iceServers,
    iceCandidatePoolSize: 10,
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
  }

  return {
    iceServers,
    iceCandidatePoolSize: 10,
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
    _configPromise = supabase
      .from('system_config')
      .select('key,value')
      .eq('section', 'video_conference')
      .then(({ data }) => {
        if (!data || data.length === 0) return buildEnvFallbackConfig();
        const cfg = Object.fromEntries(
          data.map((r: { key: string; value: string | null }) => [r.key, r.value ?? ''])
        );
        return buildRTCConfigFromDB(cfg);
      })
      .catch(() => buildEnvFallbackConfig());
  }
  return _configPromise;
}

/** Call this after the admin saves video_conference settings to pick up the new values. */
export function invalidateRTCConfigCache(): void {
  _configPromise = null;
}
