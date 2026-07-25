import { useEffect } from 'react';
import { Phone, PhoneOff, ShieldCheck } from 'lucide-react';
import type { IncomingCall } from './types';
import { getUserInitials } from './ActiveCallView';

interface Props {
  incomingCall: IncomingCall;
  onAccept: () => void;
  onReject: () => void;
}

function playRingTone(): () => void {
  try {
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    let stopped = false;
    const scheduleRing = (startAt: number) => {
      if (stopped) return;
      const freqs = [880, 1100, 880];
      freqs.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const g   = ctx.createGain();
        osc.connect(g); g.connect(ctx.destination);
        osc.frequency.value = freq;
        osc.type = 'sine';
        const t = startAt + i * 0.35;
        g.gain.setValueAtTime(0.15, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
        osc.start(t);
        osc.stop(t + 0.28);
      });
    };
    scheduleRing(ctx.currentTime);
    const iv = setInterval(() => scheduleRing(ctx.currentTime), 2500);
    return () => {
      stopped = true;
      clearInterval(iv);
      ctx.close().catch(() => {});
    };
  } catch {
    return () => {};
  }
}

export function IncomingRingView({ incomingCall, onAccept, onReject }: Props) {
  useEffect(() => {
    const stop = playRingTone();
    return stop;
  }, []);

  const initials = getUserInitials(incomingCall.callerName);

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="flex flex-col items-center justify-center min-h-[420px] gap-8 py-10 select-none"
    >
      {/* Pulse rings — respects reduced motion */}
      <div className="relative flex items-center justify-center">
        <span
          className="absolute inline-flex w-36 h-36 rounded-full bg-emerald-500/15 motion-safe:animate-ping"
          style={{ animationDuration: '2s' }}
        />
        <span
          className="absolute inline-flex w-28 h-28 rounded-full bg-emerald-500/25 motion-safe:animate-ping"
          style={{ animationDuration: '2s', animationDelay: '0.5s' }}
        />
        <div className="relative w-24 h-24 rounded-full bg-gray-800 border-4 border-emerald-500 flex items-center justify-center shadow-xl">
          <span className="text-white text-2xl font-bold tracking-wide">{initials}</span>
        </div>
      </div>

      {/* Caller info */}
      <div className="text-center space-y-1.5">
        <p className="text-white text-2xl font-bold">{incomingCall.callerName || 'مخاطب ناشناس'}</p>
        <div className="flex items-center justify-center gap-1.5 text-emerald-400 text-sm">
          <ShieldCheck aria-hidden="true" className="w-4 h-4" />
          <span>تماس رمزگذاری‌شده سرتاسری</span>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-12">
        {/* Reject */}
        <div className="flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={onReject}
            aria-label="رد کردن تماس"
            className="w-16 h-16 rounded-full bg-red-600 hover:bg-red-700 active:bg-red-800 flex items-center justify-center shadow-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
          >
            <PhoneOff aria-hidden="true" className="w-7 h-7 text-white" />
          </button>
          <span className="text-gray-400 text-xs">رد کردن</span>
        </div>

        {/* Accept — gentle pulse instead of hard bounce */}
        <div className="flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={onAccept}
            aria-label="پاسخ دادن به تماس"
            className="w-16 h-16 rounded-full bg-emerald-500 hover:bg-emerald-600 active:bg-emerald-700 flex items-center justify-center shadow-lg transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 motion-safe:animate-pulse"
            style={{ animationDuration: '2s' }}
          >
            <Phone aria-hidden="true" className="w-7 h-7 text-white" />
          </button>
          <span className="text-gray-300 text-xs font-medium">پاسخ</span>
        </div>
      </div>
    </div>
  );
}
