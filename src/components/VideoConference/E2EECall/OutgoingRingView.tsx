import { useEffect } from 'react';
import { PhoneOff, ShieldCheck } from 'lucide-react';
import type { UserProfile } from './types';

interface Props {
  targetUser: UserProfile | null;
  sessionCode: string;
  onCancel: () => void;
}

export function OutgoingRingView({ targetUser, sessionCode, onCancel }: Props) {
  // Subtle outgoing dial tone
  useEffect(() => {
    try {
      const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      let stopped = false;
      const scheduleDial = (startAt: number) => {
        if (stopped) return;
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.connect(g); g.connect(ctx.destination);
        osc.frequency.value = 440;
        osc.type = 'sine';
        g.gain.setValueAtTime(0.1, startAt);
        g.gain.exponentialRampToValueAtTime(0.001, startAt + 0.6);
        osc.start(startAt);
        osc.stop(startAt + 0.6);
      };
      scheduleDial(ctx.currentTime);
      const iv = setInterval(() => scheduleDial(ctx.currentTime), 3000);
      return () => {
        stopped = true;
        clearInterval(iv);
        ctx.close().catch(() => {});
      };
    } catch {
      return () => {};
    }
  }, []);

  const displayName = targetUser?.full_name || targetUser?.email || 'مخاطب';
  const initials = displayName.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase();

  return (
    <div className="flex flex-col items-center justify-center min-h-[380px] gap-7 py-10 select-none">
      {/* Avatar with spinner ring */}
      <div className="relative flex items-center justify-center">
        <svg
          className="absolute w-28 h-28 animate-spin text-emerald-500/50"
          style={{ animationDuration: '3s' }}
          viewBox="0 0 100 100"
          fill="none"
        >
          <circle cx="50" cy="50" r="46" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeDasharray="72 216" />
        </svg>
        <div className="w-20 h-20 rounded-full bg-gray-800 border-4 border-emerald-600/60 flex items-center justify-center shadow-xl">
          <span className="text-white text-xl font-bold tracking-wide">{initials}</span>
        </div>
      </div>

      {/* Status */}
      <div role="status" aria-live="polite" className="text-center space-y-1.5">
        <p className="text-white text-xl font-semibold">
          در حال تماس با {displayName}
        </p>
        <div className="flex items-center justify-center gap-1.5 text-emerald-400 text-sm">
          <ShieldCheck aria-hidden="true" className="w-4 h-4" />
          <span>در انتظار پاسخ</span>
        </div>
      </div>

      {/* Session code */}
      {sessionCode && (
        <div className="flex items-center gap-2 bg-gray-800/80 border border-gray-700 px-4 py-2 rounded-xl">
          <span className="text-gray-400 text-xs">کد جلسه:</span>
          <span className="text-gray-100 text-sm font-mono tracking-widest">{sessionCode}</span>
        </div>
      )}

      {/* Cancel */}
      <button
        type="button"
        onClick={onCancel}
        aria-label="لغو تماس"
        className="flex items-center gap-2 px-6 py-3 rounded-2xl bg-red-600 hover:bg-red-700 active:bg-red-800 text-white text-sm font-medium transition-colors shadow-lg"
      >
        <PhoneOff aria-hidden="true" className="w-4 h-4" /> لغو تماس
      </button>
    </div>
  );
}
