import { supabase } from './supabase';
import { buildRTCConfigFromDB, buildEnvFallbackConfig, log } from './rtcConfigCore';

let _configPromise: Promise<RTCConfiguration> | null = null;

export function getAuthenticatedRTCConfig(): Promise<RTCConfiguration> {
  if (!_configPromise) {
    log.info('[RTCConfig] getAuthenticatedRTCConfig: cache MISS — fetching from system_config');

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
    log.info('[RTCConfig] getAuthenticatedRTCConfig: cache HIT');
  }
  return _configPromise;
}

export function invalidateAuthenticatedRTCConfigCache(): void {
  log.info('[RTCConfig] authenticated cache invalidated — next call will re-fetch from DB');
  _configPromise = null;
}
