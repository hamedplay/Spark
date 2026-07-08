import { useState, useEffect, useCallback, useRef } from 'react';
import { X, Download, Copy, Check, RefreshCw, ChevronDown, ChevronRight, Activity, Wifi, Shield, Mic, Video, Cpu, Radio } from 'lucide-react';
import {
  debugStoreSubscribe, getDebugEvents, getRTPSnapshots, buildDebugReport,
  sanitizeDebugReportForExport, isCallDebugEnabled, isDebugSessionEnded,
} from './callDebugStore';
import type { CallDebugEvent, RTPSnapshot, MediaHealthClassification } from './callDebugStore';
import { getChannelRegistry } from './signaling';
import type { ChannelRecord } from './signaling';
import type { PortRecord } from './transforms';

// ── Props ────────────────────────────────────────────────────────────────────

interface Props {
  portRecordsRef: React.RefObject<PortRecord[]>;
  myRole: 'caller' | 'callee' | null;
  sessionId: string;
  peerConnectionId: string;
  mediaHealth: MediaHealthClassification[];
  onRunSelfTest: () => Promise<MediaHealthClassification[]>;
  onClose: () => void;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function classColor(c: MediaHealthClassification['classification']): string {
  if (c === 'HEALTHY') return 'text-emerald-400';
  if (c === 'E2EE_DECRYPT_FAILURE' || c === 'E2EE_RECEIVER_NOT_READY' || c === 'DECODER_STALLED') return 'text-red-400';
  if (c === 'INBOUND_RTP_STALLED' || c === 'LOCAL_SENDER_STALLED') return 'text-amber-400';
  return 'text-red-400';
}

function levelColor(level: CallDebugEvent['level']): string {
  if (level === 'error') return 'text-red-400';
  if (level === 'warn')  return 'text-amber-400';
  return 'text-gray-300';
}

function levelBg(level: CallDebugEvent['level']): string {
  if (level === 'error') return 'bg-red-950/40';
  if (level === 'warn')  return 'bg-amber-950/30';
  return '';
}

function catColor(cat: CallDebugEvent['category']): string {
  const map: Record<string, string> = {
    lifecycle: 'text-blue-400', media: 'text-purple-400', 'peer-connection': 'text-cyan-400',
    ice: 'text-teal-400', signaling: 'text-indigo-400', sdp: 'text-pink-400',
    rtp: 'text-orange-400', e2ee: 'text-emerald-400', transform: 'text-green-400',
    worker: 'text-gray-400', crypto: 'text-yellow-400',
  };
  return map[cat] ?? 'text-gray-400';
}

function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function fmtBytes(b: number): string {
  if (b < 1024) return `${b}B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)}KB`;
  return `${(b / 1048576).toFixed(2)}MB`;
}

function portStateColor(state: string): string {
  if (state === 'key-ready')     return 'text-emerald-400';
  if (state === 'worker-ready')  return 'text-blue-400';
  if (state === 'key-pending')   return 'text-amber-400';
  if (state === 'failed')        return 'text-red-400';
  if (state === 'closed')        return 'text-gray-500';
  return 'text-gray-400';
}

// ── Collapsible section ──────────────────────────────────────────────────────

function Section({ title, icon, children, defaultOpen = true }: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-white/10 rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2 px-4 py-3 bg-white/5 hover:bg-white/8 transition-colors text-left"
      >
        {icon}
        <span className="flex-1 font-semibold text-sm text-white">{title}</span>
        {open ? <ChevronDown className="w-4 h-4 text-gray-500" /> : <ChevronRight className="w-4 h-4 text-gray-500" />}
      </button>
      {open && <div className="p-4 space-y-2">{children}</div>}
    </div>
  );
}

function KV({ k, v, mono = false }: { k: string; v: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start gap-2 text-xs">
      <span className="text-gray-500 shrink-0 w-36">{k}</span>
      <span className={`text-gray-200 break-all ${mono ? 'font-mono' : ''}`}>{v}</span>
    </div>
  );
}

// ── Event row ────────────────────────────────────────────────────────────────

function EventRow({ ev }: { ev: CallDebugEvent }) {
  const [expanded, setExpanded] = useState(false);
  const hasData = ev.data && Object.keys(ev.data).length > 0;
  return (
    <div className={`text-[11px] font-mono leading-relaxed px-2 py-1 rounded ${levelBg(ev.level)} hover:bg-white/5 cursor-default`}>
      <div className="flex items-start gap-1.5 flex-wrap">
        <span className="text-gray-600 shrink-0 w-16 text-right">{fmtMs(ev.elapsedMs)}</span>
        <span className={`shrink-0 w-5 font-bold uppercase ${levelColor(ev.level)}`}>{ev.level[0]}</span>
        <span className={`shrink-0 ${catColor(ev.category)}`}>[{ev.category}]</span>
        <span className="text-gray-200 flex-1">{ev.event}</span>
        {hasData && (
          <button
            type="button"
            onClick={() => setExpanded(v => !v)}
            className="text-gray-600 hover:text-gray-300 transition-colors shrink-0"
          >
            {expanded ? '▾' : '▸'}
          </button>
        )}
      </div>
      {expanded && hasData && (
        <pre className="mt-1 ml-6 text-gray-400 whitespace-pre-wrap break-all text-[10px] leading-relaxed">
          {JSON.stringify(ev.data, null, 2)}
        </pre>
      )}
    </div>
  );
}

// ── RTP sender/receiver row ──────────────────────────────────────────────────

function SenderRow({ s }: { s: RTPSnapshot['senders'][0] }) {
  return (
    <div className="text-xs font-mono border border-white/5 rounded-lg p-2 space-y-0.5">
      <div className="flex items-center gap-2">
        <span className={s.kind === 'audio' ? 'text-purple-400' : 'text-cyan-400'}>{s.kind}</span>
        <span className="text-gray-500">mid={s.mid ?? '–'}</span>
        <span className={s.direction === 'sendrecv' ? 'text-emerald-400' : 'text-amber-400'}>{s.direction}</span>
        {s.currentDirection && <span className="text-gray-600">→{s.currentDirection}</span>}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-gray-400">
        <span>track: {s.trackEnabled ? 'on' : 'OFF'} / {s.trackReadyState}</span>
        <span>sent: {fmtBytes(s.bytesSent)}</span>
        <span>pkts: {s.packetsSent}</span>
        {s.kind === 'video' && <span>frames: {s.framesEncoded}</span>}
        {s.nackCount > 0 && <span className="text-amber-400">nack:{s.nackCount}</span>}
        {s.pliCount > 0 && <span className="text-amber-400">pli:{s.pliCount}</span>}
      </div>
    </div>
  );
}

function ReceiverRow({ r }: { r: RTPSnapshot['receivers'][0] }) {
  return (
    <div className="text-xs font-mono border border-white/5 rounded-lg p-2 space-y-0.5">
      <div className="flex items-center gap-2">
        <span className={r.kind === 'audio' ? 'text-purple-400' : 'text-cyan-400'}>{r.kind}</span>
        <span className="text-gray-500">mid={r.mid ?? '–'}</span>
        <span className={r.direction === 'sendrecv' ? 'text-emerald-400' : 'text-amber-400'}>{r.direction}</span>
        {r.currentDirection && <span className="text-gray-600">→{r.currentDirection}</span>}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-gray-400">
        <span>track: {r.trackReadyState}</span>
        <span>rcvd: {fmtBytes(r.bytesReceived)}</span>
        <span>pkts: {r.packetsReceived}</span>
        {r.packetsLost > 0 && <span className="text-amber-400">lost:{r.packetsLost}</span>}
        {r.jitter > 0 && <span>jitter:{r.jitter.toFixed(3)}</span>}
        {r.kind === 'video' && <><span>fr.rcvd:{r.framesReceived}</span><span>fr.dec:{r.framesDecoded}</span></>}
        {r.kind === 'audio' && r.audioLevel !== null && <span>lvl:{r.audioLevel.toFixed(3)}</span>}
      </div>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export function CallDebugCenter({
  portRecordsRef, myRole, sessionId, peerConnectionId,
  mediaHealth, onRunSelfTest, onClose,
}: Props) {
  const [events,           setEvents]           = useState<CallDebugEvent[]>([]);
  const [snapshots,        setSnapshots]        = useState<RTPSnapshot[]>([]);
  const [channelRecords,   setChannelRecords]   = useState<ChannelRecord[]>([]);
  const [sessionEnded,     setSessionEnded]     = useState(false);
  const [selfTestResult,   setSelfTestResult]   = useState<MediaHealthClassification[] | null>(null);
  const [selfTestRunning,  setSelfTestRunning]  = useState(false);
  const [copied,           setCopied]           = useState(false);
  const [catFilter,        setCatFilter]        = useState<string>('all');
  const [levelFilter,      setLevelFilter]      = useState<string>('all');
  const [eventsAutoScroll, setEventsAutoScroll] = useState(true);
  const eventsEndRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(() => {
    setEvents([...getDebugEvents()]);
    setSnapshots([...getRTPSnapshots()]);
    setChannelRecords([...getChannelRegistry().values()]);
    setSessionEnded(isDebugSessionEnded());
  }, []);

  // Subscribe to store updates
  useEffect(() => {
    refresh();
    return debugStoreSubscribe(refresh);
  }, [refresh]);

  // Auto-scroll event log to bottom
  useEffect(() => {
    if (eventsAutoScroll) {
      eventsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [events, eventsAutoScroll]);

  // Keyboard close
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);

  const latestSnap = snapshots[snapshots.length - 1] ?? null;
  const portRecords = portRecordsRef.current ?? [];

  const filteredEvents = events.filter(ev => {
    if (catFilter   !== 'all' && ev.category !== catFilter) return false;
    if (levelFilter !== 'all' && ev.level    !== levelFilter) return false;
    return true;
  });

  const handleCopyReport = async () => {
    try {
      const report = sanitizeDebugReportForExport(buildDebugReport());
      await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard not available */ }
  };

  const handleDownloadReport = () => {
    const report = sanitizeDebugReportForExport(buildDebugReport());
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `e2ee-debug-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSelfTest = async () => {
    setSelfTestRunning(true);
    setSelfTestResult(null);
    try {
      const result = await onRunSelfTest();
      setSelfTestResult(result);
    } finally {
      setSelfTestRunning(false);
    }
  };

  const categories = ['all', 'lifecycle', 'media', 'peer-connection', 'ice', 'signaling', 'sdp', 'rtp', 'e2ee', 'transform', 'worker', 'crypto'] as const;
  const levels = ['all', 'info', 'warn', 'error'] as const;

  if (!isCallDebugEnabled()) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-end bg-black/60 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Drawer */}
      <div
        role="dialog" aria-modal="true" aria-label="مرکز دیباگ تماس"
        className="relative flex flex-col w-full max-w-2xl bg-gray-950 border-l border-white/10 overflow-hidden"
        dir="ltr"
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-white/10 bg-gray-900/80 shrink-0">
          <Activity className="w-5 h-5 text-blue-400" />
          <span className="flex-1 font-bold text-white text-sm">E2EE Call Debug Center</span>
          <span className="text-xs text-gray-500 font-mono">
            {events.length} events · {snapshots.length} snaps
          </span>
          <button
            type="button"
            onClick={refresh}
            aria-label="Refresh"
            className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">

          {/* ── Call Overview ── */}
          <Section title="Call Overview" icon={<Wifi className="w-4 h-4 text-blue-400" />}>
            <KV k="Role"             v={myRole ?? '—'} />
            <KV k="Session ID"       v={sessionId   ? sessionId.slice(0, 8)   : '—'} mono />
            <KV k="PC ID"            v={peerConnectionId ? peerConnectionId.slice(0, 8) : '—'} mono />
            <KV k="Debug Lifecycle"  v={<span className={sessionEnded ? 'text-amber-400' : 'text-emerald-400'}>{sessionEnded ? 'ENDED (preserved)' : 'active'}</span>} />
            {latestSnap && <>
              <KV k="Connection"            v={latestSnap.pcStates.connectionState} />
              <KV k="ICE Connection"        v={latestSnap.pcStates.iceConnectionState} />
              <KV k="ICE Gathering"         v={latestSnap.pcStates.iceGatheringState} />
              <KV k="WebRTC Signaling State" v={latestSnap.pcStates.signalingState} />
              {latestSnap.candidatePair && <>
                <KV k="Local cand"   v={latestSnap.candidatePair.localType} />
                <KV k="Remote cand"  v={latestSnap.candidatePair.remoteType} />
              </>}
            </>}
            {!latestSnap && <p className="text-xs text-gray-600">No RTP snapshot yet.</p>}
          </Section>

          {/* ── Media Health ── */}
          <Section title="Media Health" icon={<Activity className="w-4 h-4 text-orange-400" />}>
            {mediaHealth.length === 0 && <p className="text-xs text-gray-600">No health data yet — call must be active.</p>}
            {mediaHealth.map((h, i) => (
              <div key={i} className="text-xs">
                <div className="flex items-center gap-2">
                  <span className="text-gray-500 w-24">{h.direction}/{h.kind}</span>
                  <span className={`font-semibold ${classColor(h.classification)}`}>{h.classification}</span>
                </div>
                <p className="text-gray-500 mt-0.5 mr-24 leading-snug">{h.persianExplanation}</p>
              </div>
            ))}

            {/* Self-test */}
            <div className="pt-2 border-t border-white/5">
              <button
                type="button"
                onClick={handleSelfTest}
                disabled={selfTestRunning}
                className="flex items-center gap-2 text-xs bg-blue-600/80 hover:bg-blue-600 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg transition-colors"
              >
                {selfTestRunning
                  ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> در حال اجرا...</>
                  : <><Activity className="w-3.5 h-3.5" /> اجرای تست تماس</>
                }
              </button>
              {selfTestResult && (
                <div className="mt-2 space-y-1">
                  {selfTestResult.map((h, i) => (
                    <div key={i} className="text-xs flex items-center gap-2">
                      <span className="text-gray-500 w-24">{h.direction}/{h.kind}</span>
                      <span className={`font-semibold ${classColor(h.classification)}`}>{h.classification}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Section>

          {/* ── E2EE Transforms ── */}
          <Section title="E2EE Transforms" icon={<Shield className="w-4 h-4 text-emerald-400" />}>
            {portRecords.length === 0 && <p className="text-xs text-gray-600">No transforms registered yet.</p>}
            {portRecords.map(pr => (
              <div key={pr.id} className="text-xs font-mono border border-white/5 rounded-lg p-2 space-y-0.5">
                <div className="flex items-center gap-2">
                  <span className={pr.kind === 'audio' ? 'text-purple-400' : 'text-cyan-400'}>{pr.kind}</span>
                  <span className="text-gray-500">{pr.role}</span>
                  <span className={`font-semibold ${portStateColor(pr.state)}`}>{pr.state}</span>
                  {pr.installedEpoch !== null && <span className="text-gray-600">epoch={pr.installedEpoch}</span>}
                </div>
                <div className="text-gray-600">id={pr.id.slice(0, 8)}</div>
              </div>
            ))}
          </Section>

          {/* ── Realtime Signaling ── */}
          <Section title="Realtime Signaling" icon={<Radio className="w-4 h-4 text-indigo-400" />} defaultOpen={true}>
            {channelRecords.length === 0 && <p className="text-xs text-gray-600">No channel records yet.</p>}
            {channelRecords.map(rec => (
              <div key={rec.channelId} className="text-xs font-mono border border-white/5 rounded-lg p-2 space-y-0.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-indigo-400">{rec.purpose}</span>
                  <span className={
                    rec.status === 'subscribed' ? 'text-emerald-400' :
                    rec.status === 'subscribing' ? 'text-blue-400' :
                    rec.status === 'failed' ? 'text-red-400' :
                    rec.status === 'removed' ? 'text-gray-500' : 'text-gray-400'
                  }>{rec.status}</span>
                  {rec.lastSupabaseStatus && <span className="text-gray-600">sb:{rec.lastSupabaseStatus}</span>}
                </div>
                <div className="text-gray-600">id={rec.channelId.slice(0, 8)} · topic={rec.topicSummary}</div>
                {rec.subscribeAttemptId && <div className="text-gray-700">attempt={rec.subscribeAttemptId.slice(0, 8)}</div>}
                {rec.subscribedAt && rec.subscribeStartedAt && (
                  <div className="text-gray-600">subscribed in {rec.subscribedAt - rec.subscribeStartedAt}ms</div>
                )}
                {rec.safeLastError && (
                  <div className="text-red-400 mt-0.5">{rec.safeLastError.name}: {rec.safeLastError.message}</div>
                )}
              </div>
            ))}
          </Section>

          {/* ── RTP Senders ── */}
          <Section title="RTP Senders" icon={<Mic className="w-4 h-4 text-purple-400" />} defaultOpen={false}>
            {!latestSnap && <p className="text-xs text-gray-600">No snapshot.</p>}
            {latestSnap?.senders.map((s, i) => <SenderRow key={i} s={s} />)}
          </Section>

          {/* ── RTP Receivers ── */}
          <Section title="RTP Receivers" icon={<Video className="w-4 h-4 text-cyan-400" />} defaultOpen={false}>
            {!latestSnap && <p className="text-xs text-gray-600">No snapshot.</p>}
            {latestSnap?.receivers.map((r, i) => <ReceiverRow key={i} r={r} />)}
          </Section>

          {/* ── Signaling / Event Log ── */}
          <Section title={`Event Log (${filteredEvents.length}/${events.length})`} icon={<Cpu className="w-4 h-4 text-indigo-400" />} defaultOpen={false}>
            {/* Filters */}
            <div className="flex flex-wrap gap-2 mb-2">
              <div className="flex items-center gap-1">
                <span className="text-gray-600 text-[11px]">cat:</span>
                <select
                  value={catFilter}
                  onChange={e => setCatFilter(e.target.value)}
                  className="text-[11px] bg-gray-800 border border-white/10 rounded px-1 py-0.5 text-gray-300"
                >
                  {categories.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-gray-600 text-[11px]">level:</span>
                <select
                  value={levelFilter}
                  onChange={e => setLevelFilter(e.target.value)}
                  className="text-[11px] bg-gray-800 border border-white/10 rounded px-1 py-0.5 text-gray-300"
                >
                  {levels.map(l => <option key={l} value={l}>{l}</option>)}
                </select>
              </div>
              <label className="flex items-center gap-1 text-[11px] text-gray-500 cursor-pointer">
                <input
                  type="checkbox"
                  checked={eventsAutoScroll}
                  onChange={e => setEventsAutoScroll(e.target.checked)}
                  className="accent-blue-500"
                />
                auto-scroll
              </label>
            </div>

            {/* Event list */}
            <div className="max-h-80 overflow-y-auto space-y-0.5 pr-1">
              {filteredEvents.length === 0 && <p className="text-xs text-gray-600">No events match filter.</p>}
              {filteredEvents.map(ev => <EventRow key={ev.id} ev={ev} />)}
              <div ref={eventsEndRef} />
            </div>
          </Section>

        </div>

        {/* Footer: copy / download */}
        <div className="shrink-0 flex items-center gap-2 px-4 py-3 border-t border-white/10 bg-gray-900/50">
          <button
            type="button"
            onClick={handleCopyReport}
            className="flex items-center gap-1.5 text-xs bg-gray-700 hover:bg-gray-600 text-gray-200 px-3 py-1.5 rounded-lg transition-colors"
          >
            {copied ? <><Check className="w-3.5 h-3.5 text-emerald-400" /> Copied!</> : <><Copy className="w-3.5 h-3.5" /> Copy Report</>}
          </button>
          <button
            type="button"
            onClick={handleDownloadReport}
            className="flex items-center gap-1.5 text-xs bg-gray-700 hover:bg-gray-600 text-gray-200 px-3 py-1.5 rounded-lg transition-colors"
          >
            <Download className="w-3.5 h-3.5" /> Download Report
          </button>
          <span className="flex-1" />
          <span className="text-[11px] text-gray-600 font-mono">
            {events.filter(e => e.level === 'error').length}E · {events.filter(e => e.level === 'warn').length}W · {events.filter(e => e.level === 'info').length}I
          </span>
        </div>
      </div>
    </div>
  );
}
