import { Coffee, Play, TimerReset } from 'lucide-react';
import { useState } from 'react';
import type {
  ConferencePhaseController,
  ConferencePhasePolicy,
} from '../../types/conference.types';

interface Props {
  phase: ConferencePhaseController;
}

function parseDuration(value: string, min: number, max: number): number | null {
  const seconds = Number(value);
  return Number.isInteger(seconds) && seconds >= min && seconds <= max
    ? seconds
    : null;
}

export function MeetingPhaseControls({ phase }: Props) {
  const [countdownSeconds, setCountdownSeconds] = useState('30');
  const [breakSeconds, setBreakSeconds] = useState('600');
  const [breakPolicy, setBreakPolicy] = useState<ConferencePhasePolicy>({
    allowMic: false,
    allowCamera: false,
    allowChat: true,
  });

  if (!phase.canManage) return null;

  const countdown = parseDuration(countdownSeconds, 10, 3600);
  const breakDuration = parseDuration(breakSeconds, 10, 7200);

  return (
    <section className="mb-2 rounded-2xl border border-violet-400/20 bg-violet-500/5 p-3" dir="rtl">
      <div className="mb-3 flex items-center justify-between gap-2">
        <strong className="text-xs text-violet-200">مدیریت فاز جلسه</strong>
        <span className="rounded-full bg-slate-800 px-2 py-1 text-[10px] text-slate-300">
          {phase.currentPhase}
        </span>
      </div>

      {phase.currentPhase === 'SCHEDULED' && (
        <button
          disabled={phase.busy}
          onClick={() => void phase.runAction('open_waiting')}
          className="flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-violet-600 text-xs font-bold disabled:opacity-50"
        >
          <Play className="h-4 w-4" />
          باز کردن جلسه
        </button>
      )}

      {phase.currentPhase === 'WAITING' && (
        <div className="space-y-2">
          <label className="block text-[10px] text-slate-400">شمارش معکوس شروع جلسه (ثانیه)</label>
          <div className="flex gap-2">
            <select
              value={['30', '60', '300', '600'].includes(countdownSeconds) ? countdownSeconds : ''}
              onChange={(event) => event.target.value && setCountdownSeconds(event.target.value)}
              className="h-10 rounded-xl border border-white/10 bg-slate-900 px-2 text-xs"
              aria-label="زمان شمارش معکوس"
            >
              <option value="">سفارشی</option>
              <option value="30">۳۰ ثانیه</option>
              <option value="60">۱ دقیقه</option>
              <option value="300">۵ دقیقه</option>
              <option value="600">۱۰ دقیقه</option>
            </select>
            <input
              value={countdownSeconds}
              onChange={(event) => setCountdownSeconds(event.target.value)}
              inputMode="numeric"
              className="h-10 min-w-0 flex-1 rounded-xl border border-white/10 bg-slate-900 px-3 text-xs"
              aria-label="زمان سفارشی شمارش معکوس به ثانیه"
            />
          </div>
          <button
            disabled={phase.busy || countdown === null}
            onClick={() => countdown && void phase.runAction('start_countdown', countdown)}
            className="flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-violet-600 text-xs font-bold disabled:opacity-50"
          >
            <TimerReset className="h-4 w-4" />
            شروع شمارش معکوس
          </button>
        </div>
      )}

      {phase.currentPhase === 'LIVE' && (
        <div className="space-y-2">
          <label className="block text-[10px] text-slate-400">مدت استراحت (ثانیه)</label>
          <div className="flex gap-2">
            <select
              value={['300', '600', '900', '1800'].includes(breakSeconds) ? breakSeconds : ''}
              onChange={(event) => event.target.value && setBreakSeconds(event.target.value)}
              className="h-10 rounded-xl border border-white/10 bg-slate-900 px-2 text-xs"
              aria-label="مدت استراحت"
            >
              <option value="">سفارشی</option>
              <option value="300">۵ دقیقه</option>
              <option value="600">۱۰ دقیقه</option>
              <option value="900">۱۵ دقیقه</option>
              <option value="1800">۳۰ دقیقه</option>
            </select>
            <input
              value={breakSeconds}
              onChange={(event) => setBreakSeconds(event.target.value)}
              inputMode="numeric"
              className="h-10 min-w-0 flex-1 rounded-xl border border-white/10 bg-slate-900 px-3 text-xs"
              aria-label="مدت سفارشی استراحت به ثانیه"
            />
          </div>

          <div className="grid grid-cols-3 gap-1.5 text-[10px]">
            {([
              ['allowMic', 'میکروفون'],
              ['allowCamera', 'دوربین'],
              ['allowChat', 'چت'],
            ] as const).map(([key, label]) => (
              <label key={key} className="flex items-center justify-center gap-1 rounded-lg bg-slate-900 px-2 py-2">
                <input
                  type="checkbox"
                  checked={breakPolicy[key]}
                  onChange={(event) => setBreakPolicy((current) => ({
                    ...current,
                    [key]: event.target.checked,
                  }))}
                />
                {label}
              </label>
            ))}
          </div>

          <button
            disabled={phase.busy || breakDuration === null}
            onClick={() => breakDuration && void phase.runAction(
              'start_break',
              breakDuration,
              breakPolicy,
            )}
            className="flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-amber-600 text-xs font-bold disabled:opacity-50"
          >
            <Coffee className="h-4 w-4" />
            شروع استراحت
          </button>
        </div>
      )}

      {phase.currentPhase === 'BREAK' && (
        <button
          disabled={phase.busy}
          onClick={() => void phase.runAction('resume')}
          className="flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 text-xs font-bold disabled:opacity-50"
        >
          <Play className="h-4 w-4" />
          پایان زودتر استراحت
        </button>
      )}

      {(phase.currentPhase === 'COUNTDOWN' || phase.currentPhase === 'RESUMING') && (
        <p className="text-center text-[10px] text-slate-400">
          تغییر فاز بعدی توسط زمان‌سنج server-side انجام می‌شود.
        </p>
      )}
    </section>
  );
}
