import { useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, Loader2, Network, RotateCcw } from 'lucide-react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { DeviceSelector, type DevicePrefs } from './DeviceSelector';
import { useConferenceTooltips } from './useConferenceTooltips';
import {
  preflightMessage,
  runConferencePreflight,
  type ConferenceMediaTopology,
  type ConferencePreflightResult,
} from './conferencePreflight';

type Props = {
  onConfirm: (stream: MediaStream, prefs: DevicePrefs) => void;
  loadRTCConfig: () => Promise<RTCConfiguration>;
  client: SupabaseClient<any>;
  roomId?: string | null;
  userId?: string | null;
  mediaTopology?: ConferenceMediaTopology | null;
  submitLabel?: string;
  submitDisabled?: boolean;
  compactViewport?: boolean;
  children?: React.ReactNode;
};

export function PreflightDeviceSelector(props: Props) {
  useConferenceTooltips();
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<ConferencePreflightResult | null>(null);
  const [pending, setPending] = useState<{ stream: MediaStream; prefs: DevicePrefs } | null>(null);

  const run = async (stream: MediaStream, prefs: DevicePrefs) => {
    setTesting(true);
    setResult(null);
    try {
      const next = await runConferencePreflight({
        stream,
        loadRTCConfig: props.loadRTCConfig,
        client: props.client,
        roomId: props.roomId,
        userId: props.userId,
        mediaTopology: props.mediaTopology,
      });
      setResult(next);
      if (next.verdict === 'good') {
        props.onConfirm(stream, prefs);
      } else {
        setPending({ stream, prefs });
      }
    } catch (error) {
      console.error('conference preflight failed', error);
      const mediaTopology = props.mediaTopology === 'sfu' ? 'sfu' : 'mesh';
      setResult({
        micOk: false,
        cameraOk: false,
        turnUdpOk: false,
        turnTcpOk: false,
        rttMs: null,
        packetLossPct: null,
        verdict: 'failed',
        mediaTopology,
        turnProbeRequired: mediaTopology === 'mesh',
        details: {},
      });
      setPending({ stream, prefs });
    } finally {
      setTesting(false);
    }
  };

  const reset = () => {
    pending?.stream.getTracks().forEach(track => track.stop());
    setPending(null);
    setResult(null);
  };

  const verdictClass = result?.verdict === 'good'
    ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200'
    : result?.verdict === 'warning'
      ? 'border-amber-500/20 bg-amber-500/10 text-amber-100'
      : 'border-rose-500/25 bg-rose-500/10 text-rose-100';

  return (
    <DeviceSelector
      onConfirm={run}
      submitLabel={testing ? 'در حال بررسی اتصال...' : props.submitLabel}
      submitDisabled={props.submitDisabled || testing || Boolean(pending)}
      compactViewport={props.compactViewport}
    >
      {props.children}

      {testing && (
        <div className="flex items-center gap-2 rounded-xl border border-sky-400/15 bg-sky-400/10 px-3 py-2.5 text-xs text-sky-100">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>{props.mediaTopology === 'sfu' ? 'در حال بررسی دستگاه‌ها و دسترسی شبکه...' : 'در حال بررسی دستگاه‌ها، شبکه و مسیر جایگزین...'}</span>
        </div>
      )}

      {result && (
        <div className={`rounded-xl border px-3 py-2.5 text-sm ${verdictClass}`}>
          <div className="flex items-start gap-2">
            {result.verdict === 'good'
              ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold leading-6">{preflightMessage(result)}</p>
              {result.mediaTopology === 'sfu' && (
                <p className="mt-0.5 text-[10px] opacity-70">مسیر رسانه و TURN در زمان اتصال امن به LiveKit مذاکره می‌شود.</p>
              )}
            </div>
          </div>

          <details className="mt-2 text-[10px] opacity-80">
            <summary className="flex cursor-pointer list-none items-center gap-1 font-semibold">
              <ChevronDown className="h-3 w-3" /> جزئیات اتصال
            </summary>
            <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 rounded-lg bg-black/10 p-2 sm:grid-cols-3">
              <span>میکروفون: {result.micOk ? 'آماده' : 'ناموفق'}</span>
              <span>دوربین: {result.cameraOk ? 'آماده' : 'ناموفق'}</span>
              <span>RTT: {result.rttMs === null ? 'نامشخص' : `${result.rttMs}ms`}</span>
              <span>Probe Loss: {result.packetLossPct === null ? 'نامشخص' : `${result.packetLossPct}%`}</span>
              {result.turnProbeRequired ? (
                <>
                  <span>TURN/UDP: {result.turnUdpOk ? 'آماده' : 'ناموفق'}</span>
                  <span>TURN/TCP: {result.turnTcpOk ? 'آماده' : 'ناموفق'}</span>
                </>
              ) : (
                <span className="col-span-2">رسانه: LiveKit SFU</span>
              )}
            </div>
          </details>

          {pending && (
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  const current = pending;
                  setPending(null);
                  props.onConfirm(current.stream, current.prefs);
                }}
                className="min-h-10 flex-1 rounded-lg bg-teal-500 px-3 py-2 text-xs font-bold text-slate-950 transition hover:bg-teal-400"
              >
                ادامه و ورود
              </button>
              <button
                type="button"
                onClick={reset}
                className="flex min-h-10 items-center gap-1 rounded-lg border border-current/25 px-3 py-2 text-xs"
              >
                <RotateCcw className="h-3.5 w-3.5" /> تست مجدد
              </button>
            </div>
          )}
        </div>
      )}

      {!result && !testing && (
        <div className="flex items-center gap-2 text-[10px] text-slate-400">
          <Network className="h-3.5 w-3.5" />
          <span>{props.mediaTopology === 'sfu' ? 'پیش از ورود، دستگاه‌ها و دسترسی شبکه بررسی می‌شوند.' : 'پیش از ورود، دستگاه‌ها، شبکه و مسیر TURN بررسی می‌شوند.'}</span>
        </div>
      )}
    </DeviceSelector>
  );
}
