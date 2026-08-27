import type { MeetingPhase } from '../../types/conference.types';

interface Props {
  phase: MeetingPhase;
  remainingSeconds: number | null;
}

function formatSeconds(value: number): string {
  const seconds = Math.max(0, value);
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${rest.toString().padStart(2, '0')}`;
}

export function MeetingPhaseOverlay({ phase, remainingSeconds }: Props) {
  if (phase === 'COUNTDOWN') {
    return (
      <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-slate-950 px-6 text-center" dir="rtl">
        <div className="text-sm font-bold text-violet-300">شروع جلسه</div>
        <div className="mt-5 font-mono text-7xl font-black tracking-tight text-white sm:text-9xl" aria-live="polite">
          {formatSeconds(remainingSeconds ?? 0)}
        </div>
        <p className="mt-5 max-w-md text-sm leading-7 text-slate-400">
          در زمان شمارش معکوس تصویر و صدای شرکت‌کنندگان نمایش داده نمی‌شود و انتشار میکروفون و دوربین غیرفعال است.
        </p>
      </div>
    );
  }

  if (phase === 'RESUMING') {
    return (
      <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-slate-950 px-6 text-center" dir="rtl">
        <div className="text-lg font-black text-white">در حال بازگشت به جلسه…</div>
        <div className="mt-4 font-mono text-5xl font-black text-violet-300" aria-live="polite">
          {formatSeconds(remainingSeconds ?? 0)}
        </div>
      </div>
    );
  }

  if (phase === 'BREAK') {
    return (
      <div className="pointer-events-none absolute inset-x-0 top-20 z-30 flex justify-center px-3" dir="rtl">
        <div className="rounded-3xl border border-amber-300/20 bg-slate-950/90 px-8 py-5 text-center shadow-2xl backdrop-blur">
          <div className="text-sm font-bold text-amber-300">زمان استراحت</div>
          <div className="mt-2 font-mono text-5xl font-black text-white sm:text-6xl" aria-live="polite">
            {formatSeconds(remainingSeconds ?? 0)}
          </div>
        </div>
      </div>
    );
  }

  return null;
}
