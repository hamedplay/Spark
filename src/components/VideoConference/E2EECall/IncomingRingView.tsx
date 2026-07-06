import { useEffect } from 'react';
import { Phone, PhoneOff, ShieldCheck } from 'lucide-react';
import type { IncomingCall } from './types';

interface Props {
  incomingCall: IncomingCall;
  onAccept: () => void;
  onReject: () => void;
}

function playRingTone(): (() => void) {
  try {
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    let stopped = false;
    const scheduleRing = (startAt: number) => {
      if (stopped) return;
      const freqs = [880, 1100, 880];
      freqs.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.connect(g); g.connect(ctx.destination);
        osc.frequency.value = freq;
        osc.type = 'sine';
        const t = startAt + i * 0.35;
        g.gain.setValueAtTime(0.2, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
        osc.start(t);
        osc.stop(t + 0.3);
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

  const initials = incomingCall.callerName
    ? incomingCall.callerName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
    : '?';

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="flex flex-col items-center justify-center min-h-[420px] gap-8 py-10 select-none"
    >
      {/* Pulse rings */}
      <div className="relative flex items-center justify-center">
        <span className="absolute inline-flex w-36 h-36 rounded-full bg-emerald-500/20 animate-ping" style={{ animationDuration: '1.4s' }} />
        <span className="absolute inline-flex w-28 h-28 rounded-full bg-emerald-500/30 animate-ping" style={{ animationDuration: '1.4s', animationDelay: '0.3s' }} />
        <div className="relative w-24 h-24 rounded-full bg-gray-800 border-4 border-emerald-500 flex items-center justify-center shadow-xl">
          <span className="text-white text-2xl font-bold tracking-wide">{initials}</span>
        </div>
      </div>

      {/* Caller info */}
      <div className="text-center space-y-1.5">
        <p className="text-white text-2xl font-bold">{incomingCall.callerName}</p>
        <div className="flex items-center justify-center gap-1.5 text-emerald-400 text-sm">
          <ShieldCheck aria-hidden="true" className="w-4 h-4" />
          <span>تماس با رمزنگاری سرتاسری</span>
        </div>
        <p className="text-gray-500 text-xs mt-1 max-w-xs leading-relaxed">
          پس از اتصال، Safety Number را برای تأیید عدم MITM بررسی کنید.
        </p>
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-10">
        {/* Reject */}
        <div className="flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={onReject}
            aria-label="رد کردن تماس"
            className="w-16 h-16 rounded-full bg-red-600 hover:bg-red-700 active:bg-red-800 flex items-center justify-center shadow-lg transition-colors"
          >
            <PhoneOff aria-hidden="true" className="w-7 h-7 text-white" />
          </button>
          <span className="text-gray-400 text-xs">رد کردن</span>
        </div>

        {/* Accept */}
        <div className="flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={onAccept}
            aria-label="پاسخ دادن به تماس"
            className="w-16 h-16 rounded-full bg-emerald-500 hover:bg-emerald-600 active:bg-emerald-700 flex items-center justify-center shadow-lg transition-transform hover:scale-105 animate-bounce"
            style={{ animationDuration: '1s' }}
          >
            <Phone aria-hidden="true" className="w-7 h-7 text-white" />
          </button>
          <span className="text-gray-300 text-xs font-medium">پاسخ</span>
        </div>
      </div>
    </div>
  );
}
