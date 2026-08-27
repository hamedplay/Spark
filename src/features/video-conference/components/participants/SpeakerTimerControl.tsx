import { useState } from 'react';
import type {
  SpeakerSessionRow,
  SpeakerTimerAction,
} from '../../types/conference.types';

interface Props {
  userId: string;
  session: SpeakerSessionRow | undefined;
  remainingSeconds: number | undefined;
  busy: boolean;
  onAction: (
    targetUserId: string,
    action: SpeakerTimerAction,
    seconds?: number,
  ) => Promise<void>;
}

const presets = [
  { label: '۳۰ث', seconds: 30 },
  { label: '۱د', seconds: 60 },
  { label: '۲د', seconds: 120 },
  { label: '۳د', seconds: 180 },
  { label: '۵د', seconds: 300 },
];

function formatSeconds(value: number | undefined): string {
  const seconds = Math.max(0, value ?? 0);
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${rest.toString().padStart(2, '0')}`;
}

export function SpeakerTimerControl({
  userId,
  session,
  remainingSeconds,
  busy,
  onAction,
}: Props) {
  const [customSeconds, setCustomSeconds] = useState('60');
  const open = session?.status === 'ACTIVE' || session?.status === 'PAUSED';

  const startCustom = () => {
    const seconds = Number(customSeconds);
    if (!Number.isInteger(seconds) || seconds < 10 || seconds > 3600) return;
    void onAction(userId, 'start', seconds);
  };

  return (
    <div className="mt-2 rounded-lg border border-white/10 bg-slate-950/60 p-2">
      <div className="mb-2 flex items-center justify-between gap-2 text-[10px] text-slate-300">
        <span>زمان صحبت</span>
        {session && <strong className="font-mono text-amber-300">{formatSeconds(remainingSeconds)}</strong>}
      </div>

      {!open ? (
        <div className="flex flex-wrap items-center gap-1">
          {presets.map((preset) => (
            <button
              key={preset.seconds}
              disabled={busy}
              onClick={() => void onAction(userId, 'start', preset.seconds)}
              className="h-8 rounded-md bg-slate-800 px-2 text-[10px] disabled:opacity-50"
            >
              {preset.label}
            </button>
          ))}
          <input
            value={customSeconds}
            onChange={(event) => setCustomSeconds(event.target.value)}
            inputMode="numeric"
            aria-label="زمان سفارشی صحبت به ثانیه"
            className="h-8 w-16 rounded-md border border-white/10 bg-slate-900 px-2 text-[10px]"
          />
          <button
            disabled={busy}
            onClick={startCustom}
            className="h-8 rounded-md bg-violet-600 px-2 text-[10px] font-bold disabled:opacity-50"
          >
            شروع
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-1">
          <button disabled={busy} onClick={() => void onAction(userId, 'extend', 30)} className="h-8 rounded-md bg-slate-800 px-2 text-[10px] disabled:opacity-50">+۳۰ث</button>
          <button disabled={busy} onClick={() => void onAction(userId, 'extend', 60)} className="h-8 rounded-md bg-slate-800 px-2 text-[10px] disabled:opacity-50">+۱د</button>
          {session?.status === 'ACTIVE' ? (
            <button disabled={busy} onClick={() => void onAction(userId, 'pause')} className="h-8 rounded-md bg-amber-700 px-2 text-[10px] disabled:opacity-50">توقف موقت</button>
          ) : (
            <button disabled={busy} onClick={() => void onAction(userId, 'resume')} className="h-8 rounded-md bg-emerald-700 px-2 text-[10px] disabled:opacity-50">ادامه</button>
          )}
          <button disabled={busy} onClick={() => void onAction(userId, 'stop')} className="h-8 rounded-md bg-rose-700 px-2 text-[10px] disabled:opacity-50">پایان</button>
        </div>
      )}
    </div>
  );
}
