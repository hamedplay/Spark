import type { SupabaseClient } from '@supabase/supabase-js';

export type ConferencePreflightVerdict = 'good' | 'warning' | 'failed';
export type ConferenceMediaTopology = 'mesh' | 'sfu';

export interface ConferencePreflightResult {
  micOk: boolean;
  cameraOk: boolean;
  turnUdpOk: boolean;
  turnTcpOk: boolean;
  rttMs: number | null;
  packetLossPct: number | null;
  verdict: ConferencePreflightVerdict;
  mediaTopology: ConferenceMediaTopology;
  turnProbeRequired: boolean;
  details: Record<string, unknown>;
}

type RTCConfigLoader = () => Promise<RTCConfiguration>;

async function probeNetwork(): Promise<{ rttMs: number | null; lossPct: number }> {
  const base = String(import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
  if (!base) return { rttMs: null, lossPct: 100 };
  const samples: number[] = [];
  let failed = 0;
  for (let i = 0; i < 3; i += 1) {
    const started = performance.now();
    try {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 2500);
      await fetch(`${base}/rest/v1/`, { method: 'HEAD', cache: 'no-store', signal: controller.signal });
      clearTimeout(timer);
      samples.push(performance.now() - started);
    } catch {
      failed += 1;
    }
  }
  return {
    rttMs: samples.length ? Math.round(samples.reduce((a, b) => a + b, 0) / samples.length) : null,
    lossPct: Math.round((failed / 3) * 10000) / 100,
  };
}

async function probeTurn(loadRTCConfig: RTCConfigLoader) {
  const config = await loadRTCConfig();
  const servers = config.iceServers || [];
  const hasTurn = servers.some(server => {
    const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
    return urls.some(url => typeof url === 'string' && (url.startsWith('turn:') || url.startsWith('turns:')));
  });
  if (!hasTurn) return { udp: false, tcp: false, hasTurn: false, candidates: [] as string[] };

  const pc = new RTCPeerConnection({ ...config, iceTransportPolicy: 'relay' });
  pc.createDataChannel('spark-preflight');
  let udp = false;
  let tcp = false;
  const candidates: string[] = [];
  pc.onicecandidate = event => {
    if (!event.candidate) return;
    const candidate = event.candidate.candidate || '';
    if (!candidate.includes(' typ relay ')) return;
    candidates.push(candidate);
    const protocol = (event.candidate.protocol || '').toLowerCase();
    if (protocol === 'udp') udp = true;
    if (protocol === 'tcp') tcp = true;
  };
  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await Promise.race([
      new Promise<void>(resolve => {
        if (pc.iceGatheringState === 'complete') {
          resolve();
          return;
        }
        pc.addEventListener('icegatheringstatechange', () => {
          if (pc.iceGatheringState === 'complete') resolve();
        });
      }),
      new Promise<void>(resolve => window.setTimeout(resolve, 4500)),
    ]);
  } finally {
    pc.close();
  }
  return { udp, tcp, hasTurn, candidates };
}

export async function runConferencePreflight(input: {
  stream: MediaStream;
  loadRTCConfig: RTCConfigLoader;
  client: SupabaseClient<any>;
  roomId?: string | null;
  userId?: string | null;
  mediaTopology?: ConferenceMediaTopology | null;
}): Promise<ConferencePreflightResult> {
  const mediaTopology: ConferenceMediaTopology = input.mediaTopology === 'sfu' ? 'sfu' : 'mesh';
  const micOk = input.stream.getAudioTracks().some(t => t.readyState === 'live');
  const cameraOk = input.stream.getVideoTracks().some(t => t.readyState === 'live');

  // LiveKit/SFU obtains its ICE/TURN configuration after the room token is issued.
  // A raw browser RTCPeerConnection using the legacy Mesh RTC config is therefore
  // not an authoritative SFU readiness check and must never block an SFU join.
  const [network, turn] = await Promise.all([
    probeNetwork(),
    mediaTopology === 'mesh'
      ? probeTurn(input.loadRTCConfig).catch(() => ({ udp: false, tcp: false, hasTurn: true, candidates: [] as string[] }))
      : Promise.resolve({ udp: false, tcp: false, hasTurn: false, candidates: [] as string[] }),
  ]);

  const turnProbeRequired = mediaTopology === 'mesh';
  const networkFailed = network.rttMs === null || network.lossPct >= 60;
  const turnFailed = turnProbeRequired && turn.hasTurn && !turn.udp && !turn.tcp;
  const degraded = !micOk || !cameraOk || network.lossPct > 20 || (network.rttMs ?? 9999) > 600 || turnFailed;
  const verdict: ConferencePreflightVerdict = networkFailed || turnFailed ? 'failed' : degraded ? 'warning' : 'good';

  const result: ConferencePreflightResult = {
    micOk,
    cameraOk,
    turnUdpOk: turn.udp,
    turnTcpOk: turn.tcp,
    rttMs: network.rttMs,
    packetLossPct: network.lossPct,
    verdict,
    mediaTopology,
    turnProbeRequired,
    details: {
      turnConfigured: turn.hasTurn,
      relayCandidates: turn.candidates.length,
      turnProbeRequired,
      transport: mediaTopology === 'sfu' ? 'livekit_sfu' : 'webrtc_mesh',
      rttSource: 'supabase_http_probe',
      packetLossSource: 'three_http_prejoin_probes',
      note: mediaTopology === 'sfu'
        ? 'SFU ICE/TURN is negotiated by LiveKit after token issuance; the legacy relay probe is intentionally skipped.'
        : 'Packet loss before joining is an application-network probe, not RTP loss.',
    },
  };

  if (input.userId) {
    const { error } = await input.client.from('conference_preflight_results').insert({
      room_id: input.roomId || null,
      user_id: input.userId,
      mic_ok: result.micOk,
      camera_ok: result.cameraOk,
      turn_udp_ok: result.turnUdpOk,
      turn_tcp_ok: result.turnTcpOk,
      rtt_ms: result.rttMs,
      packet_loss_pct: result.packetLossPct,
      verdict: result.verdict,
      details: result.details,
    });
    if (error) console.warn('conference preflight persistence failed', error);
  }
  return result;
}

export function preflightMessage(result: ConferencePreflightResult) {
  if (!result.micOk && !result.cameraOk) return 'دوربین و میکروفون آماده نیستند.';
  if (!result.micOk) return 'میکروفون آماده نیست؛ می‌توانید تنظیمات دستگاه را بررسی کنید.';
  if (!result.cameraOk) return 'دوربین آماده نیست؛ ورود صوتی همچنان امکان‌پذیر است.';

  if (result.verdict === 'good') {
    return result.mediaTopology === 'sfu'
      ? 'برای ورود به جلسه LiveKit آماده‌اید.'
      : 'دستگاه‌ها و مسیر ارتباطی برای ورود آماده‌اند.';
  }
  if (result.verdict === 'warning') return 'اتصال قابل استفاده است، اما کیفیت شبکه ممکن است نوسان داشته باشد.';
  return 'اتصال شبکه ضعیف است؛ می‌توانید دوباره تست کنید یا با همین وضعیت وارد شوید.';
}