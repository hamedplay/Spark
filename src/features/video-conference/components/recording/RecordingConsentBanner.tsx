import { CheckCircle2, Loader2, Radio, ShieldAlert, XCircle } from 'lucide-react';
import type { ConferenceRecordingConsentController } from '../../types/conference.types';

export function RecordingConsentBanner({
  consent,
}: {
  consent: ConferenceRecordingConsentController;
}) {
  if (!consent.loaded || !consent.recordingEnabled || !consent.required) {
    return null;
  }

  if (consent.accepted) {
    return (
      <div className="flex h-9 shrink-0 items-center gap-1.5 rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-2.5 text-[10px] font-bold text-emerald-200" aria-live="polite" title="رضایت ضبط ثبت شده">
        <CheckCircle2 className="h-3.5 w-3.5" />
        <span className="hidden lg:inline">رضایت ضبط ثبت شده</span>
      </div>
    );
  }

  return (
    <div className="absolute inset-x-3 top-[68px] z-40 mx-auto max-w-xl rounded-2xl border border-amber-400/30 bg-slate-900/95 p-3 shadow-2xl backdrop-blur" dir="rtl">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-amber-300">
          {consent.recordingActive
            ? <Radio className="h-4 w-4" />
            : <ShieldAlert className="h-4 w-4" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-white">
            رضایت برای ضبط جلسه
          </div>
          <p className="mt-1 text-[11px] leading-5 text-slate-300">
            {consent.recordingActive
              ? 'ضبط این جلسه فعال است. ادامه حضور رسانه‌ای مستلزم ثبت رضایت شما برای ضبط صدا و تصویر جلسه است.'
              : 'این جلسه قابلیت ضبط سروری دارد. برای اینکه میزبان بتواند ضبط را شروع کند، وضعیت رضایت خود را مشخص کنید.'}
          </p>

          {consent.errorMessage && (
            <div className="mt-2 text-[10px] text-rose-300">
              {consent.errorMessage}
            </div>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void consent.setConsent(true)}
              disabled={consent.busy}
              className="flex min-h-9 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-[11px] font-bold text-white disabled:opacity-50"
            >
              {consent.busy
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <CheckCircle2 className="h-3.5 w-3.5" />}
              موافقم
            </button>
            <button
              type="button"
              onClick={() => void consent.setConsent(false)}
              disabled={consent.busy}
              className="flex min-h-9 items-center gap-1.5 rounded-lg border border-rose-400/30 px-3 text-[11px] font-bold text-rose-200 disabled:opacity-50"
            >
              <XCircle className="h-3.5 w-3.5" />
              موافق نیستم
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}