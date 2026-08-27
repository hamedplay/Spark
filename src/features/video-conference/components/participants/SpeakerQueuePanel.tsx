import { ChevronDown, ChevronUp, UserRoundCheck, X } from 'lucide-react';
import { useState } from 'react';
import type {
  SpeakerQueueAction,
  SpeakerQueueItem,
} from '../../types/conference.types';

interface Props {
  items: SpeakerQueueItem[];
  canManage: boolean;
  busy: string | null;
  onAction: (
    targetUserId: string,
    action: SpeakerQueueAction,
    seconds?: number,
  ) => Promise<void>;
}

const PRESETS = [30, 60, 120, 180, 300];

function formatSeconds(value: number): string {
  const minutes = Math.floor(value / 60);
  const seconds = value % 60;
  return minutes > 0
    ? `${minutes}:${seconds.toString().padStart(2, '0')} دقیقه`
    : `${seconds} ثانیه`;
}

function QueueRow({
  item,
  index,
  total,
  canManage,
  busy,
  onAction,
}: {
  item: SpeakerQueueItem;
  index: number;
  total: number;
  canManage: boolean;
  busy: boolean;
  onAction: Props['onAction'];
}) {
  const [customSeconds, setCustomSeconds] = useState(
    String(item.session.allocated_seconds),
  );
  const presetValue = PRESETS.includes(item.session.allocated_seconds)
    ? String(item.session.allocated_seconds)
    : '';

  const applyCustom = () => {
    const seconds = Number(customSeconds);
    if (!Number.isInteger(seconds) || seconds < 10 || seconds > 3600) return;
    void onAction(item.participant.user_id, 'set_time', seconds);
  };

  return (
    <div className="rounded-xl border border-amber-400/15 bg-amber-400/5 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-amber-400 px-1 text-[10px] font-black text-slate-950">
              {index + 1}
            </span>
            <strong className="truncate text-xs">
              {item.participant.display_name || 'شرکت‌کننده'}
            </strong>
          </div>
          <div className="mt-1 text-[10px] text-slate-400">
            زمان صحبت: {formatSeconds(item.session.allocated_seconds)}
          </div>
        </div>

        {canManage && (
          <div className="flex shrink-0 items-center gap-1">
            <button
              disabled={busy || index === 0}
              onClick={() => void onAction(item.participant.user_id, 'move_up')}
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-800 disabled:opacity-40"
              aria-label="انتقال یک ردیف به بالا"
            >
              <ChevronUp className="h-4 w-4" />
            </button>
            <button
              disabled={busy || index === total - 1}
              onClick={() => void onAction(item.participant.user_id, 'move_down')}
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-800 disabled:opacity-40"
              aria-label="انتقال یک ردیف به پایین"
            >
              <ChevronDown className="h-4 w-4" />
            </button>
            <button
              disabled={busy}
              onClick={() => void onAction(item.participant.user_id, 'remove')}
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-900/80 disabled:opacity-40"
              aria-label="حذف از صف صحبت"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      {canManage && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <select
            value={presetValue}
            disabled={busy}
            onChange={(event) => {
              const seconds = Number(event.target.value);
              if (!Number.isInteger(seconds)) return;
              setCustomSeconds(String(seconds));
              void onAction(item.participant.user_id, 'set_time', seconds);
            }}
            className="h-8 rounded-lg border border-white/10 bg-slate-900 px-2 text-[10px]"
            aria-label="زمان از پیش تعریف شده"
          >
            <option value="">سفارشی</option>
            <option value="30">۳۰ ثانیه</option>
            <option value="60">۱ دقیقه</option>
            <option value="120">۲ دقیقه</option>
            <option value="180">۳ دقیقه</option>
            <option value="300">۵ دقیقه</option>
          </select>

          <input
            value={customSeconds}
            disabled={busy}
            onChange={(event) => setCustomSeconds(event.target.value)}
            inputMode="numeric"
            aria-label="زمان سفارشی صحبت به ثانیه"
            className="h-8 w-20 rounded-lg border border-white/10 bg-slate-900 px-2 text-[10px]"
          />
          <button
            disabled={busy}
            onClick={applyCustom}
            className="h-8 rounded-lg bg-slate-800 px-2 text-[10px] font-bold disabled:opacity-40"
          >
            ثبت زمان
          </button>
          <button
            disabled={busy}
            onClick={() => void onAction(item.participant.user_id, 'allow')}
            className="flex h-8 items-center gap-1 rounded-lg bg-emerald-600 px-2 text-[10px] font-bold disabled:opacity-40"
          >
            <UserRoundCheck className="h-3.5 w-3.5" />
            اجازه صحبت
          </button>
        </div>
      )}
    </div>
  );
}

export function SpeakerQueuePanel({
  items,
  canManage,
  busy,
  onAction,
}: Props) {
  if (items.length === 0) return null;

  return (
    <section className="mb-2 rounded-2xl border border-amber-400/20 bg-slate-950/50 p-2">
      <div className="mb-2 flex items-center justify-between px-1">
        <strong className="text-xs text-amber-300">صف صحبت</strong>
        <span className="text-[10px] text-slate-400">{items.length} نفر</span>
      </div>
      <div className="space-y-2">
        {items.map((item, index) => (
          <QueueRow
            key={item.session.id}
            item={item}
            index={index}
            total={items.length}
            canManage={canManage}
            busy={Boolean(
              busy?.startsWith(`queue:${item.participant.user_id}:`),
            )}
            onAction={onAction}
          />
        ))}
      </div>
    </section>
  );
}
