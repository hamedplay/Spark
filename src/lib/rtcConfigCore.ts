/**
 * Pure RTC configuration logic — no I/O, no Supabase client imports.
 * Shared by authenticatedRtcConfig.ts and guestRtcConfig.ts.
 */

const IS_DEV = import.meta.env.DEV;
const log = {
  info:  (...a: unknown[]) => IS_DEV && console.info(...a),
  warn:  (...a: unknown[]) => IS_DEV && console.warn(...a),
  error: (...a: unknown[]) => console.error(...a),
};

const FALLBACK_STUN: RTCIceServer = {
  urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'],
};

function stripTurnScheme(raw: string): string {
  return raw
    .replace(/^turns?:\/\//i, '')
    .replace(/^turns?:/i, '')
    .split('?')[0]
    .split('/')[0]
    .trim();
}

export function buildRTCConfigFromDB(cfg: Record<string, string>): RTCConfiguration {
  const turnServerUrl    = cfg['turn_server']?.trim()           || '';
  const username         = cfg['turn_username']?.trim()         || '';
  const credential       = cfg['turn_credential']?.trim()       || '';
  const stunServersStr   = cfg['stun_servers']?.trim()          || '';
  const policyKey        = cfg['ice_transport_policy']?.trim()  || 'auto';
  const turnFallback     = cfg['enable_turn_fallback']?.trim()  !== 'false';

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

  if (!hasStun) {
    iceServers.unshift(FALLBACK_STUN);
    log.info('[RTCConfig] No STUN configured — added public Google STUN fallback');
  }

  let iceTransportPolicy: RTCIceTransportPolicy;
  switch (policyKey) {
    case 'relay':
      iceTransportPolicy = 'relay';
      break;
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

export function buildEnvFallbackConfig(): RTCConfiguration {
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

export { log };
