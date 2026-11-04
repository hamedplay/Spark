interface AgentData {
  platform?: string;
  mobile?: boolean;
  getHighEntropyValues?: (keys: string[]) => Promise<Record<string, unknown>>;
}
let cached: Promise<Record<string, unknown>> | null = null;
/** Optional browser disclosure, used only for description and never authorization. */
export function collectClientHints(): Promise<Record<string, unknown>> {
  if (cached) return cached;
  cached = (async () => {
    const nav = navigator as Navigator & { userAgentData?: AgentData };
    const agent = nav.userAgentData;
    const basic = { maxTouchPoints: nav.maxTouchPoints, ...(agent ? { platform: agent.platform, mobile: agent.mobile } : {}) };
    if (!agent?.getHighEntropyValues) return basic;
    try {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const detail = await Promise.race([
        agent.getHighEntropyValues(['platformVersion', 'model', 'architecture', 'bitness', 'fullVersionList']),
        new Promise<Record<string, unknown>>(resolve => { timer = setTimeout(() => resolve({}), 800); }),
      ]).finally(() => clearTimeout(timer));
      const brands = Array.isArray(detail.fullVersionList) ? detail.fullVersionList as {brand: string; version: string}[] : [];
      const brand = ['Microsoft Edge','Google Chrome','Opera','Chromium'].map(name => brands.find(b => b.brand === name)).find(Boolean);
      return { ...basic, platformVersion: detail.platformVersion, model: detail.model, architecture: detail.architecture,
        bitness: detail.bitness, ...(brand ? { browser: brand.brand, browserVersion: brand.version } : {}) };
    } catch { return basic; }
  })();
  return cached;
}
