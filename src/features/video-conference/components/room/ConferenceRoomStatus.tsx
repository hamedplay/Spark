import { Loader2, RefreshCw, Users, WifiOff } from 'lucide-react';
import type { ConferenceUiState } from '../../types/conference.types';

interface Props {
  state: Extract<ConferenceUiState, 'joining' | 'waiting' | 'failed'>;
  errorMessage?: string;
  onRetry?: () => void;
  onLeave: () => void;
}

export function ConferenceRoomStatus({ state, errorMessage = '', onRetry, onLeave }: Props) {
  if (state === 'joining') {
    return <div className="flex min-h-[70dvh] items-center justify-center gap-3 bg-slate-950 text-white" dir="rtl"><Loader2 className="h-6 w-6 animate-spin" /> در حال اتصال امن به جلسه…</div>;
  }

  if (state === 'waiting') {
    return (
      <div className="flex min-h-[70dvh] flex-col items-center justify-center gap-4 bg-slate-950 px-5 text-center text-white" dir="rtl">
        <Users className="h-12 w-12 text-amber-300" />
        <h2 className="text-lg font-bold">در انتظار تأیید میزبان</h2>
        <p className="max-w-md text-sm leading-7 text-slate-300">تا زمانی که میزبان شما را بپذیرد هیچ توکن رسانه‌ای صادر نمی‌شود و وارد اتاق LiveKit نخواهید شد.</p>
        <button onClick={onLeave} className="min-h-11 rounded-xl border border-slate-600 px-5 text-sm">انصراف</button>
      </div>
    );
  }

  return (
    <div className="flex min-h-[70dvh] flex-col items-center justify-center gap-4 bg-slate-950 px-5 text-center text-white" dir="rtl">
      <WifiOff className="h-12 w-12 text-rose-400" />
      <h2 className="text-lg font-bold">اتصال ویدیوکنفرانس برقرار نشد</h2>
      <p className="max-w-lg text-sm leading-7 text-slate-300">{errorMessage}</p>
      <div className="flex gap-2">
        {onRetry && <button onClick={onRetry} className="min-h-11 rounded-xl bg-violet-600 px-5 text-sm font-bold"><RefreshCw className="ml-2 inline h-4 w-4" />تلاش مجدد</button>}
        <button onClick={onLeave} className="min-h-11 rounded-xl border border-slate-600 px-5 text-sm">بازگشت</button>
      </div>
    </div>
  );
}
