// @ts-nocheck
import { useRef, useCallback } from 'react';
import { logError } from './types';
import { isCallDebugEnabled, dbgInfo, dbgWarn, pushRTPSnapshot, getRTPSnapshots, analyseMediaHealth } from './callDebugStore';
import type { RTPSnapshot } from './callDebugStore';

export function useE2EERtpDiagnostics(scope: Record<string, any>) {
  const {
    localStreamRef, pcRef, portRecordsRef, presentedFrameCountRef, remoteVideoRef, setMediaHealth
  } = scope;

  // ── RTP snapshot loop ──────────────────────────────────────────────────
  const rtpSnapshotInProgressRef = useRef(false);
  const rtpSnapshotIntervalRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const stalledCountersRef       = useRef<Map<string, number>>(new Map());

  const collectRTPSnapshot = useCallback(async () => {
    const pc = pcRef.current;
    if (!pc || rtpSnapshotInProgressRef.current) return;
    rtpSnapshotInProgressRef.current = true;
    try {
      const stats = await pc.getStats();
      const transceivers = pc.getTransceivers();

      const senderStats   = new Map<string, RTCOutboundRtpStreamStats>();
      const receiverStats = new Map<string, RTCInboundRtpStreamStats>();
      let candidatePair: RTPSnapshot['candidatePair'] = null;

      stats.forEach(s => {
        if (s.type === 'outbound-rtp') senderStats.set((s as RTCOutboundRtpStreamStats).kind ?? s.id, s as RTCOutboundRtpStreamStats);
        if (s.type === 'inbound-rtp')  receiverStats.set((s as RTCInboundRtpStreamStats).kind ?? s.id, s as RTCInboundRtpStreamStats);
        if (s.type === 'candidate-pair' && (s as RTCIceCandidatePairStats).nominated) {
          const cp = s as RTCIceCandidatePairStats & { localCandidateId?: string; remoteCandidateId?: string };
          candidatePair = {
            localType:  'relay',
            remoteType: 'relay',
            localAddress: cp.localCandidateId?.slice(0, 8) ?? '',
            remoteAddress: cp.remoteCandidateId?.slice(0, 8) ?? '',
          };
        }
      });

      const snap: RTPSnapshot = {
        timestamp: Date.now(),
        pcStates: {
          connectionState:   pc.connectionState,
          iceConnectionState: pc.iceConnectionState,
          iceGatheringState:  pc.iceGatheringState,
          signalingState:     pc.signalingState,
        },
        candidatePair,
        senders: transceivers.filter(t => t.sender?.track).map((t, i) => {
          const s = senderStats.get(t.sender.track?.kind ?? '') ?? {} as Partial<RTCOutboundRtpStreamStats>;
          return {
            index: i,
            kind:  t.sender.track?.kind ?? 'unknown',
            trackEnabled: t.sender.track?.enabled ?? false,
            trackMuted:   t.sender.track?.muted ?? true,
            trackReadyState: t.sender.track?.readyState ?? 'ended',
            mid:          t.mid,
            direction:    t.direction,
            currentDirection: t.currentDirection ?? '',
            bytesSent:    (s.bytesSent   as number) ?? 0,
            packetsSent:  (s.packetsSent as number) ?? 0,
            framesEncoded: (s.framesEncoded as number) ?? 0,
            nackCount:    (s.nackCount as number) ?? 0,
            pliCount:     (s.pliCount  as number) ?? 0,
          };
        }),
        receivers: transceivers.filter(t => t.receiver?.track).map((t, i) => {
          const r = receiverStats.get(t.receiver.track?.kind ?? '') ?? {} as Partial<RTCInboundRtpStreamStats>;
          return {
            index: i,
            kind:  t.receiver.track?.kind ?? 'unknown',
            trackMuted:   t.receiver.track?.muted ?? true,
            trackReadyState: t.receiver.track?.readyState ?? 'ended',
            mid:          t.mid,
            direction:    t.direction,
            currentDirection: t.currentDirection ?? '',
            bytesReceived: (r.bytesReceived  as number) ?? 0,
            packetsReceived: (r.packetsReceived as number) ?? 0,
            packetsLost:  (r.packetsLost    as number) ?? 0,
            jitter:       (r.jitter         as number) ?? 0,
            framesReceived: (r.framesReceived as number) ?? 0,
            framesDecoded:  (r.framesDecoded  as number) ?? 0,
            audioLevel:   (r.audioLevel     as number | undefined) ?? null,
          };
        }),
        portRecordStates: portRecordsRef.current.map(pr => ({
          id:             pr.id.slice(0, 8),
          role:           pr.role,
          kind:           pr.kind,
          state:          pr.state,
          installedEpoch: pr.installedEpoch,
        })),
      };

      pushRTPSnapshot(snap);

      // Health analysis
      const snapshots = getRTPSnapshots();
      const prev = snapshots.length >= 2 ? snapshots[snapshots.length - 2] : null;
      const health = analyseMediaHealth({
        prev,
        curr: snap,
        portRecordStates: snap.portRecordStates,
        remoteVideoElement: remoteVideoRef.current,
        remoteVisibleElement: remoteVideoRef.current,
        localTracks: localStreamRef.current?.getTracks() ?? [],
        stalledCounters: stalledCountersRef.current,
        presentedFrameCount: isCallDebugEnabled() ? presentedFrameCountRef.current : null,
      });
      setMediaHealth(health);

      if (isCallDebugEnabled()) {
        const bad = health.filter(h => h.classification !== 'HEALTHY');
        if (bad.length > 0) {
          dbgWarn('rtp', 'media-health-issues', {
            issues: bad.map(h => `${h.direction}-${h.kind}:${h.classification}`),
          });
        }
      }
    } catch (err) {
      logError('[E2EE][SNAP]', 'getStats failed:', err);
    } finally {
      rtpSnapshotInProgressRef.current = false;
    }
  }, []);

  const startRTPSnapshots = useCallback(() => {
    if (rtpSnapshotIntervalRef.current) return;
    rtpSnapshotIntervalRef.current = setInterval(() => {
      void collectRTPSnapshot();
    }, 2000);
    dbgInfo('rtp', 'rtp-snapshot-loop-started');
  }, [collectRTPSnapshot]);

  const stopRTPSnapshots = useCallback(() => {
    if (rtpSnapshotIntervalRef.current) {
      clearInterval(rtpSnapshotIntervalRef.current);
      rtpSnapshotIntervalRef.current = null;
    }
    stalledCountersRef.current.clear();
    dbgInfo('rtp', 'rtp-snapshot-loop-stopped');
  }, []);

  return {
    collectRTPSnapshot, startRTPSnapshots, stopRTPSnapshots
  };
}
