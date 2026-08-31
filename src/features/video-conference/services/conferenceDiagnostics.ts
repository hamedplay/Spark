import { ConnectionQuality, Track, type Room } from 'livekit-client';
import type {
  ConferenceDiagnosticsCandidateType,
  ConferenceDiagnosticsHealth,
  ConferenceNetworkDiagnostics,
  ConferenceRtcTrackDiagnostics,
  ConferenceUiState,
} from '../types/conference.types';

type StatsLike = RTCStats & Record<string, unknown>;

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function normalizeCodec(value: string | null): string | null {
  if (!value) return null;
  const slash = value.lastIndexOf('/');
  return slash >= 0 ? value.slice(slash + 1).toUpperCase() : value.toUpperCase();
}

function candidateType(value: unknown): ConferenceDiagnosticsCandidateType {
  if (value === 'host' || value === 'srflx' || value === 'prflx' || value === 'relay') {
    return value;
  }
  return 'unknown';
}

function readStats(report: RTCStatsReport | undefined): Map<string, StatsLike> {
  const values = new Map<string, StatsLike>();
  report?.forEach((value) => {
    if (value && typeof value === 'object' && typeof value.id === 'string') {
      values.set(value.id, value as StatsLike);
    }
  });
  return values;
}

function selectedCandidatePair(stats: Map<string, StatsLike>): StatsLike | null {
  for (const value of stats.values()) {
    if (value.type !== 'transport') continue;
    const selectedId = stringValue(value.selectedCandidatePairId);
    if (selectedId && stats.has(selectedId)) return stats.get(selectedId) || null;
  }

  let fallback: StatsLike | null = null;
  for (const value of stats.values()) {
    if (value.type !== 'candidate-pair') continue;
    if (value.selected === true) return value;
    if (value.nominated === true && value.state === 'succeeded') return value;
    if (!fallback && value.state === 'succeeded') fallback = value;
  }
  return fallback;
}

function qualityToHealth(
  uiState: ConferenceUiState,
  quality: ConnectionQuality | 'unknown',
): ConferenceDiagnosticsHealth {
  if (uiState === 'reconnecting' || uiState === 'failed') return 'POOR';
  if (quality === ConnectionQuality.Excellent) return 'EXCELLENT';
  if (quality === ConnectionQuality.Good) return 'GOOD';
  if (quality === ConnectionQuality.Poor) return 'WEAK';
  if (quality === ConnectionQuality.Lost) return 'POOR';
  return 'GOOD';
}

function sourceLabel(source: Track.Source) {
  if (source === Track.Source.Camera) return 'camera';
  if (source === Track.Source.Microphone) return 'microphone';
  if (source === Track.Source.ScreenShare) return 'screen_share';
  if (source === Track.Source.ScreenShareAudio) return 'screen_share_audio';
  return 'unknown';
}

async function collectTrack(
  participantIdentity: string,
  local: boolean,
  source: Track.Source,
  publication: ReturnType<Room['localParticipant']['getTrackPublication']>,
): Promise<{
  track: ConferenceRtcTrackDiagnostics | null;
  stats: Map<string, StatsLike>;
}> {
  const track = publication?.track;
  if (!track) return { track: null, stats: new Map() };

  let report: RTCStatsReport | undefined;
  try {
    report = await track.getRTCStatsReport();
  } catch {
    report = undefined;
  }

  const stats = readStats(report);
  let codec: string | null = null;
  let width: number | null = null;
  let height: number | null = null;
  let fps: number | null = null;
  let packetsLost = 0;
  let packetsReceived = 0;
  let jitterMs: number | null = null;
  let rttMs: number | null = null;

  for (const value of stats.values()) {
    if (value.type === 'inbound-rtp' || value.type === 'outbound-rtp' || value.type === 'remote-inbound-rtp') {
      const codecId = stringValue(value.codecId);
      if (codecId) {
        const codecStat = stats.get(codecId);
        codec = normalizeCodec(stringValue(codecStat?.mimeType)) || codec;
      }

      const frameWidth = numberValue(value.frameWidth);
      const frameHeight = numberValue(value.frameHeight);
      const frameRate = numberValue(value.framesPerSecond);
      if (frameWidth && frameHeight && frameWidth * frameHeight > (width || 0) * (height || 0)) {
        width = frameWidth;
        height = frameHeight;
      }
      if (frameRate !== null) fps = Math.max(fps || 0, frameRate);

      if (value.type === 'inbound-rtp') {
        packetsLost += Math.max(0, numberValue(value.packetsLost) || 0);
        packetsReceived += Math.max(0, numberValue(value.packetsReceived) || 0);
        const jitter = numberValue(value.jitter);
        if (jitter !== null) jitterMs = Math.max(jitterMs || 0, jitter * 1000);
      }

      if (value.type === 'remote-inbound-rtp') {
        const rtt = numberValue(value.roundTripTime);
        if (rtt !== null) rttMs = Math.max(rttMs || 0, rtt * 1000);
      }
    }
  }

  const pair = selectedCandidatePair(stats);
  const pairRtt = numberValue(pair?.currentRoundTripTime);
  if (pairRtt !== null) rttMs = Math.max(rttMs || 0, pairRtt * 1000);

  return {
    track: {
      participantIdentity,
      local,
      source: sourceLabel(source),
      kind: track.kind === Track.Kind.Video ? 'video' : 'audio',
      bitrateKbps: Math.max(0, Math.round((track.currentBitrate || 0) / 1000)),
      codec,
      resolution: width && height ? `${Math.round(width)}x${Math.round(height)}` : null,
      fps: fps === null ? null : Math.round(fps * 10) / 10,
      packetsLost,
      packetsReceived,
      packetLossPercent: packetsLost + packetsReceived > 0
        ? Math.round((packetsLost / (packetsLost + packetsReceived)) * 1000) / 10
        : null,
      jitterMs: jitterMs === null ? null : Math.round(jitterMs),
      rttMs: rttMs === null ? null : Math.round(rttMs),
    },
    stats,
  };
}

export async function collectConferenceNetworkDiagnostics(
  room: Room,
  uiState: ConferenceUiState,
  quality: ConnectionQuality | 'unknown',
  reconnectCount: number,
): Promise<ConferenceNetworkDiagnostics> {
  const sources = [
    Track.Source.Camera,
    Track.Source.Microphone,
    Track.Source.ScreenShare,
    Track.Source.ScreenShareAudio,
  ];

  const participants = [
    { participant: room.localParticipant, local: true },
    ...Array.from(room.remoteParticipants.values()).map((participant) => ({
      participant,
      local: false,
    })),
  ];

  const trackResults = await Promise.all(
    participants.flatMap(({ participant, local }) => sources.map((source) =>
      collectTrack(
        participant.identity,
        local,
        source,
        participant.getTrackPublication(source),
      ),
    )),
  );

  const tracks = trackResults
    .map((result) => result.track)
    .filter((track): track is ConferenceRtcTrackDiagnostics => Boolean(track));

  const combinedStats = new Map<string, StatsLike>();
  for (const result of trackResults) {
    for (const [id, value] of result.stats) combinedStats.set(id, value);
  }

  const pair = selectedCandidatePair(combinedStats);
  const localCandidate = pair
    ? combinedStats.get(stringValue(pair.localCandidateId) || '')
    : undefined;
  const remoteCandidate = pair
    ? combinedStats.get(stringValue(pair.remoteCandidateId) || '')
    : undefined;

  const localCandidateType = candidateType(localCandidate?.candidateType);
  const remoteCandidateType = candidateType(remoteCandidate?.candidateType);
  const relay = localCandidateType === 'relay' || remoteCandidateType === 'relay';

  const candidateRtt = numberValue(pair?.currentRoundTripTime);
  const trackRtts = tracks
    .map((track) => track.rttMs)
    .filter((value): value is number => value !== null);
  const rttMs = candidateRtt !== null
    ? Math.round(candidateRtt * 1000)
    : trackRtts.length
      ? Math.round(Math.max(...trackRtts))
      : null;

  const lost = tracks.reduce((total, track) => total + track.packetsLost, 0);
  const received = tracks.reduce((total, track) => total + track.packetsReceived, 0);
  const packetLossPercent = lost + received > 0
    ? Math.round((lost / (lost + received)) * 1000) / 10
    : null;

  const jitters = tracks
    .map((track) => track.jitterMs)
    .filter((value): value is number => value !== null);

  const codecs = Array.from(new Set(
    tracks.map((track) => track.codec).filter((value): value is string => Boolean(value)),
  ));

  const videoTracks = tracks.filter((track) => track.kind === 'video' && track.resolution);
  const maxVideo = videoTracks.sort((left, right) => {
    const area = (value: ConferenceRtcTrackDiagnostics) => {
      const match = value.resolution?.match(/^(\d+)x(\d+)$/);
      return match ? Number(match[1]) * Number(match[2]) : 0;
    };
    return area(right) - area(left);
  })[0] || null;

  return {
    sampledAt: new Date().toISOString(),
    health: qualityToHealth(uiState, quality),
    connectionQuality: quality === 'unknown' ? 'unknown' : quality,
    rttMs,
    packetLossPercent,
    jitterMs: jitters.length ? Math.round(Math.max(...jitters)) : null,
    bitrateKbps: tracks.reduce((total, track) => total + track.bitrateKbps, 0),
    codecs,
    resolution: maxVideo?.resolution || null,
    fps: maxVideo?.fps || null,
    iceState: stringValue(pair?.state) || 'unknown',
    candidateType: localCandidateType,
    remoteCandidateType,
    transportProtocol: stringValue(localCandidate?.protocol) || null,
    relayProtocol: stringValue(localCandidate?.relayProtocol) || null,
    turnInUse: relay,
    reconnectCount,
    tracks,
  };
}

export function networkHealthLabel(health: ConferenceDiagnosticsHealth) {
  if (health === 'EXCELLENT') return 'Excellent';
  if (health === 'GOOD') return 'Good';
  if (health === 'WEAK') return 'Weak';
  return 'Poor';
}
