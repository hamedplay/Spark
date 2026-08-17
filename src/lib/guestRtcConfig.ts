import { guestSupabase } from './guestSupabase';
import { buildRTCConfigFromDB, buildEnvFallbackConfig, log } from './rtcConfigCore';

let _guestConfigPromise: Promise<RTCConfiguration> | null = null;

export function getGuestRTCConfig(): Promise<RTCConfiguration> {
  if (!_guestConfigPromise) {
    log.info('[RTCConfig] getGuestRTCConfig: cache MISS — fetching via anonymous RPC');

    const timeout = new Promise<RTCConfiguration>((_, reject) =>
      setTimeout(() => reject(new Error('RTC config fetch timeout')), 5000)
    );

    const rpcFetch = guestSupabase
      .rpc('get_public_conference_runtime_config')
      .then(({ data }) => {
        if (!data || data.length === 0) {
          log.warn('[RTCConfig] guest RPC returned no rows — using env fallback');
          return buildEnvFallbackConfig();
        }
        const cfg = Object.fromEntries(
          data.map((r: { key: string; value: string | null }) => [r.key, r.value ?? ''])
        );
        return buildRTCConfigFromDB(cfg);
      });

    _guestConfigPromise = Promise.race([rpcFetch, timeout])
      .catch((err) => {
        log.error('[RTCConfig] guest RPC fetch failed or timed out — using env fallback:', err);
        return buildEnvFallbackConfig();
      });
  } else {
    log.info('[RTCConfig] getGuestRTCConfig: cache HIT');
  }
  return _guestConfigPromise;
}

export function invalidateGuestRTCConfigCache(): void {
  log.info('[RTCConfig] guest cache invalidated — next call will re-fetch via RPC');
  _guestConfigPromise = null;
}
