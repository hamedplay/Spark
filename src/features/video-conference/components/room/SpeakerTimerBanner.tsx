import type { SpeakerSessionRow } from '../../types/conference.types';

interface Props {
  session: SpeakerSessionRow | null;
  remainingSeconds: number | null;
}

function formatSeconds(value: number): string {
  const seconds = Math.max(0, value);
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${rest.toString().padStart(2, '0')}`;
}

export function SpeakerTimerBanner({ session, remainingSeconds }: Props) {
  if (!session) return null;

  if (session.status === 'ACTIVE') {
    return (
      <div className="absolute right-3 top-[68px] z-30 rounded-full bg-amber-500 px-3 py-1.5 text-xs font-bold text-slate-950 shadow-lg" aria-live="polite">
        زمان صحبت: {formatSeconds(remainingSeconds ?? 0)}
      </div>
    );
  }

  if (session.status === 'PAUSED') {
    return (
      <div className="absolute right-3 top-[68px] z-30 rounded-xl bg-amber-700 px-3 py-2 text-xs font-bold text-white shadow-lg" aria-live="polite">
        زمان صحبت موقتاً متوقف شده و مجوز میکروفون غیرفعال است.
      </div>
    );
  }

  if (session.status === 'EXPIRED') {
    return (
      <div className="absolute right-3 top-[68px] z-30 max-w-sm rounded-xl bg-rose-700 px-3 py-2 text-xs font-bold text-white shadow-lg" role="alert">
        زمان صحبت شما به پایان رسید؛ میکروفون توسط سامانه غیرفعال شد.
      </div>
    );
  }

  if (session.status === 'COMPLETED') {
    return (
      <div className="absolute right-3 top-[68px] z-30 max-w-sm rounded-xl bg-slate-700 px-3 py-2 text-xs font-bold text-white shadow-lg" aria-live="polite">
        نوبت صحبت شما توسط مدیر جلسه پایان یافت و مجوز میکروفون غیرفعال شد.
      </div>
    );
  }

  return null;
}
