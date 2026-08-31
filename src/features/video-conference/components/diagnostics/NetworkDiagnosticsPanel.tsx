import { Activity, Radio, RefreshCw, ShieldCheck, Wifi } from 'lucide-react';
import { networkHealthLabel } from '../../services/conferenceDiagnostics';
import type { ConferenceNetworkDiagnostics } from '../../types/conference.types';

function value(value: number | null, suffix: string) {
  return value === null ? '—' : `${value}${suffix}`;
}

function boolLabel(value: boolean) {
  return value ? 'بله' : 'خیر';
}

export function NetworkDiagnosticsPanel({
  diagnostics,
  onRefresh,
}: {
  diagnostics: ConferenceNetworkDiagnostics;
  onRefresh: () => Promise<void>;
}) {
  const health = networkHealthLabel(diagnostics.health);

  return (
    <div className="max-h-[55dvh] overflow-y-auto p-4 text-xs">
      <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-slate-950/70 p-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-300">
            <Activity className="h-5 w-5" />
          </div>
          <div>
            <div className="text-sm font-bold">Network: {health}</div>
            <div className="mt-1 text-[10px] text-slate-400">
              نمونه‌برداری {diagnostics.sampledAt ? new Date(diagnostics.sampledAt).toLocaleTimeString('fa-IR') : 'در انتظار…'}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void onRefresh()}
          className="flex h-9 items-center gap-1 rounded-lg border border-white/10 px-3 text-slate-200 hover:bg-white/10"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          بروزرسانی
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Metric label="RTT" value={value(diagnostics.rttMs, ' ms')} />
        <Metric label="Packet loss" value={value(diagnostics.packetLossPercent, '%')} />
        <Metric label="Jitter" value={value(diagnostics.jitterMs, ' ms')} />
        <Metric label="Bitrate" value={`${diagnostics.bitrateKbps} kbps`} />
        <Metric label="Resolution" value={diagnostics.resolution || '—'} />
        <Metric label="FPS" value={value(diagnostics.fps, '')} />
        <Metric label="Codec" value={diagnostics.codecs.join(', ') || '—'} />
        <Metric label="ICE state" value={diagnostics.iceState} />
        <Metric label="Candidate" value={diagnostics.candidateType} />
        <Metric label="Protocol" value={diagnostics.transportProtocol || '—'} />
        <Metric label="TURN" value={boolLabel(diagnostics.turnInUse)} />
        <Metric label="Reconnect" value={String(diagnostics.reconnectCount)} />
      </div>

      <div className="mt-4 rounded-xl border border-white/10 bg-slate-950/70 p-3">
        <div className="mb-2 flex items-center gap-2 font-bold">
          <ShieldCheck className="h-4 w-4 text-sky-300" />
          ICE / TURN
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[11px]">
          <span className="text-slate-400">Local candidate</span>
          <span>{diagnostics.candidateType}</span>
          <span className="text-slate-400">Remote candidate</span>
          <span>{diagnostics.remoteCandidateType}</span>
          <span className="text-slate-400">Relay protocol</span>
          <span>{diagnostics.relayProtocol || '—'}</span>
          <span className="text-slate-400">TURN relay</span>
          <span>{diagnostics.turnInUse ? 'Active' : 'Not detected'}</span>
        </div>
      </div>

      <div className="mt-4 overflow-hidden rounded-xl border border-white/10 bg-slate-950/70">
        <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2 font-bold">
          <Radio className="h-4 w-4 text-violet-300" />
          Media tracks
        </div>
        <div className="divide-y divide-white/5">
          {diagnostics.tracks.length === 0 && (
            <div className="p-4 text-center text-slate-500">هنوز RTC stats قابل خواندن نیست.</div>
          )}
          {diagnostics.tracks.map((track, index) => (
            <div key={`${track.local}-${track.source}-${index}`} className="grid grid-cols-[1fr_auto] gap-2 px-3 py-2">
              <div>
                <div className="font-semibold">
                  {track.local ? 'Local' : 'Remote'} · {track.source}
                </div>
                <div className="mt-1 text-[10px] text-slate-400">
                  {track.codec || 'codec —'} · {track.resolution || 'resolution —'} · {track.fps ?? '—'} fps
                </div>
              </div>
              <div className="text-left text-[10px] text-slate-300">
                <div>{track.bitrateKbps} kbps</div>
                <div>{track.packetLossPercent ?? '—'}% loss</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4 flex gap-2 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-[10px] leading-5 text-amber-100">
        <Wifi className="mt-0.5 h-4 w-4 shrink-0" />
        این پنل عمداً IP، candidate address، SDP، توکن‌ها و credentialهای TURN را نمایش نمی‌دهد.
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-slate-950/70 p-3">
      <div className="text-[10px] text-slate-500">{label}</div>
      <div className="mt-1 break-words text-xs font-bold text-slate-100">{value}</div>
    </div>
  );
}
