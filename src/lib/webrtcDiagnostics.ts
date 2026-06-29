// WebRTC diagnostics service — collects per-connection stats and logs them.
// Designed to be drop-in: call `startDiagnostics(pc, peerId)` right after
// building a PeerConnection and `stopDiagnostics(peerId)` when it closes.
// Future SFU migration: replace `pc.getStats()` calls with SFU SDK equivalents.

export interface PeerDiagnostics {
  peerId: string;
  timestamp: number;
  connectionState: RTCPeerConnectionState;
  iceConnectionState: RTCIceConnectionState;
  signalingState: RTCSignalingState;
  selectedCandidatePair: {
    localType: string;
    remoteType: string;
    protocol: string;
  } | null;
  rttMs: number | null;
  packetLossPct: number | null;
  outboundBitrateKbps: number | null;
  inboundBitrateKbps: number | null;
}

type DiagnosticsCallback = (d: PeerDiagnostics) => void;

const sessions = new Map<string, { pc: RTCPeerConnection; timer: ReturnType<typeof setInterval>; prevBytes: { out: number; in: number; ts: number } }>();

// Tracks one RTCPeerConnection, calling onUpdate every `intervalMs` (default 5s).
export function startDiagnostics(
  pc: RTCPeerConnection,
  peerId: string,
  onUpdate: DiagnosticsCallback,
  intervalMs = 5000,
) {
  if (sessions.has(peerId)) stopDiagnostics(peerId);

  const prevBytes = { out: 0, in: 0, ts: Date.now() };

  const timer = setInterval(async () => {
    if (pc.connectionState === 'closed') { stopDiagnostics(peerId); return; }

    const diag: PeerDiagnostics = {
      peerId,
      timestamp: Date.now(),
      connectionState: pc.connectionState,
      iceConnectionState: pc.iceConnectionState,
      signalingState: pc.signalingState,
      selectedCandidatePair: null,
      rttMs: null,
      packetLossPct: null,
      outboundBitrateKbps: null,
      inboundBitrateKbps: null,
    };

    try {
      const stats = await pc.getStats();
      let outBytes = 0, inBytes = 0;
      let packetsSent = 0, packetsLost = 0;

      stats.forEach((r: any) => {
        // Selected candidate pair → RTT + candidate types
        if (r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded') {
          if (typeof r.currentRoundTripTime === 'number') {
            diag.rttMs = Math.round(r.currentRoundTripTime * 1000);
          }
          // Get candidate details
          const local = stats.get(r.localCandidateId);
          const remote = stats.get(r.remoteCandidateId);
          if (local && remote) {
            diag.selectedCandidatePair = {
              localType: local.candidateType ?? '?',
              remoteType: remote.candidateType ?? '?',
              protocol: local.protocol ?? '?',
            };
          }
        }

        // Outbound RTP → bytes sent
        if (r.type === 'outbound-rtp') outBytes += r.bytesSent ?? 0;

        // Inbound RTP → bytes received + packet loss
        if (r.type === 'inbound-rtp') {
          inBytes += r.bytesReceived ?? 0;
          packetsSent += (r.packetsReceived ?? 0) + (r.packetsLost ?? 0);
          packetsLost += r.packetsLost ?? 0;
        }
      });

      // Bitrate (kbps)
      const now = Date.now();
      const elapsed = (now - prevBytes.ts) / 1000;
      if (elapsed > 0) {
        diag.outboundBitrateKbps = Math.round(((outBytes - prevBytes.out) * 8) / elapsed / 1000);
        diag.inboundBitrateKbps = Math.round(((inBytes - prevBytes.in) * 8) / elapsed / 1000);
      }
      prevBytes.out = outBytes;
      prevBytes.in = inBytes;
      prevBytes.ts = now;

      // Packet loss
      if (packetsSent > 0) {
        diag.packetLossPct = Math.round((packetsLost / packetsSent) * 1000) / 10;
      }
    } catch {
      // pc may have been closed between tick and getStats()
    }

    onUpdate(diag);

    // Console log when quality is degraded
    if (
      diag.rttMs !== null && diag.rttMs > 400 ||
      diag.packetLossPct !== null && diag.packetLossPct > 5
    ) {
      console.warn(`[WebRTC Diag] ${peerId} — RTT: ${diag.rttMs}ms  Loss: ${diag.packetLossPct}%  Bitrate↑: ${diag.outboundBitrateKbps}kbps`);
    }
  }, intervalMs);

  sessions.set(peerId, { pc, timer, prevBytes });
}

export function stopDiagnostics(peerId: string) {
  const s = sessions.get(peerId);
  if (s) { clearInterval(s.timer); sessions.delete(peerId); }
}

export function stopAllDiagnostics() {
  for (const [peerId] of sessions) stopDiagnostics(peerId);
}

// Utility: attempt ICE restart on a degraded connection.
// Returns true if a new offer was created and sent.
export async function attemptICERestart(
  pc: RTCPeerConnection,
  sendOffer: (offer: RTCSessionDescriptionInit) => void,
): Promise<boolean> {
  if (pc.signalingState !== 'stable') return false;
  try {
    const offer = await pc.createOffer({ iceRestart: true });
    await pc.setLocalDescription(offer);
    sendOffer(offer);
    console.info('[WebRTC] ICE restart initiated');
    return true;
  } catch (e) {
    console.error('[WebRTC] ICE restart failed', e);
    return false;
  }
}
