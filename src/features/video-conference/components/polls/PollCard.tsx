import { useEffect, useMemo, useState } from 'react';
import { EyeOff, Lock, Play, Trash2, Users } from 'lucide-react';
import type { ConferencePollItem } from '../../types/conference.types';

const TYPE_LABELS: Record<ConferencePollItem['pollType'], string> = {
  SINGLE_CHOICE: 'تک‌انتخابی',
  MULTIPLE_CHOICE: 'چندانتخابی',
  YES_NO: 'بله / خیر',
  TRUE_FALSE: 'درست / نادرست',
};

interface Props {
  poll: ConferencePollItem;
  busy: string | null;
  onVote: (poll: ConferencePollItem, optionIds: string[]) => Promise<boolean>;
  onOpen: (pollId: string) => Promise<boolean>;
  onClose: (pollId: string) => Promise<boolean>;
  onDelete: (pollId: string) => Promise<boolean>;
}

export function PollCard({
  poll,
  busy,
  onVote,
  onOpen,
  onClose,
  onDelete,
}: Props) {
  const [selected, setSelected] = useState<string[]>(poll.mySelectedOptionIds);
  const isMultiple = poll.pollType === 'MULTIPLE_CHOICE';

  useEffect(() => {
    setSelected(poll.mySelectedOptionIds);
  }, [poll.id, poll.mySelectedOptionIds]);

  const optionLabels = useMemo(
    () => new Map(poll.options.map((option) => [option.id, option.label])),
    [poll.options],
  );

  const toggle = (optionId: string) => {
    if (!poll.canVote || busy) return;
    setSelected((current) => {
      if (!isMultiple) return [optionId];
      return current.includes(optionId)
        ? current.filter((id) => id !== optionId)
        : [...current, optionId];
    });
  };

  const submitVote = async () => {
    if (!poll.canVote || selected.length === 0) return;
    await onVote(poll, selected);
  };

  return (
    <article className="space-y-3 rounded-xl border border-white/10 bg-slate-950/50 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap gap-1 text-[9px]">
            <span className="rounded-full bg-slate-800 px-2 py-0.5">
              {TYPE_LABELS[poll.pollType]}
            </span>
            <span className="rounded-full bg-slate-800 px-2 py-0.5">
              {poll.anonymous ? 'ناشناس' : 'شناسایی‌شده'}
            </span>
            <span className={`rounded-full px-2 py-0.5 ${
              poll.status === 'OPEN'
                ? 'bg-emerald-900/60 text-emerald-200'
                : 'bg-slate-800 text-slate-300'
            }`}>
              {poll.status === 'DRAFT' ? 'پیش‌نویس' : poll.status === 'OPEN' ? 'باز' : 'بسته'}
            </span>
          </div>
          <h3 className="text-sm font-semibold leading-6">{poll.question}</h3>
          {poll.closesAt && poll.status === 'OPEN' && (
            <p className="mt-1 text-[9px] text-slate-400">
              پایان خودکار: {new Date(poll.closesAt).toLocaleTimeString('fa-IR', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              })}
            </p>
          )}
        </div>

        {poll.canManage && (
          <div className="flex shrink-0 gap-1">
            {poll.status === 'DRAFT' && (
              <button
                type="button"
                onClick={() => void onOpen(poll.id)}
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-950 text-emerald-200"
                aria-label="باز کردن نظرسنجی"
              >
                <Play className="h-3.5 w-3.5" />
              </button>
            )}
            {poll.status === 'OPEN' && (
              <button
                type="button"
                onClick={() => void onClose(poll.id)}
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-950 text-amber-200"
                aria-label="بستن نظرسنجی"
              >
                <Lock className="h-3.5 w-3.5" />
              </button>
            )}
            <button
              type="button"
              onClick={() => void onDelete(poll.id)}
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-950 text-rose-200"
              aria-label="حذف نظرسنجی"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      <div className="space-y-1.5">
        {poll.options.map((option) => {
          const checked = selected.includes(option.id);
          const count = option.voteCount;
          const pct = count !== null && poll.totalVoters
            ? Math.round((count / poll.totalVoters) * 100)
            : 0;

          return (
            <button
              key={option.id}
              type="button"
              disabled={!poll.canVote}
              onClick={() => toggle(option.id)}
              className={`w-full rounded-xl border px-3 py-2 text-right text-xs ${
                checked
                  ? 'border-cyan-400 bg-cyan-950/40'
                  : 'border-white/10 bg-slate-900'
              } disabled:cursor-default`}
            >
              <div className="flex items-center justify-between gap-2">
                <span>{option.label}</span>
                {count !== null && (
                  <span className="text-[9px] text-slate-400">
                    {count} رأی · {pct}٪
                  </span>
                )}
              </div>
              {count !== null && (
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-slate-700">
                  <div
                    className="h-full rounded-full bg-cyan-500 transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              )}
            </button>
          );
        })}
      </div>

      {poll.canVote && (
        <button
          type="button"
          disabled={selected.length === 0 || busy === `vote:${poll.id}`}
          onClick={() => void submitVote()}
          className="w-full rounded-xl bg-cyan-600 px-3 py-2 text-xs font-bold disabled:opacity-50"
        >
          ثبت رأی{isMultiple ? '‌های انتخاب‌شده' : ''}
        </button>
      )}

      {!poll.resultsVisible && (
        <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
          <EyeOff className="h-3.5 w-3.5" />
          نتیجه طبق تنظیم Poll هنوز قابل مشاهده نیست.
        </div>
      )}

      {poll.resultsVisible && poll.totalVoters !== null && (
        <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
          <Users className="h-3.5 w-3.5" />
          {poll.totalVoters} رأی‌دهنده
        </div>
      )}

      {poll.canManage && !poll.anonymous && poll.voters.length > 0 && (
        <details className="rounded-lg bg-slate-900 px-3 py-2">
          <summary className="cursor-pointer text-[10px] text-slate-300">
            رأی‌دهندگان شناسایی‌شده
          </summary>
          <div className="mt-2 space-y-1">
            {poll.voters.map((voter, index) => (
              <div key={`${voter.userId}-${voter.optionId}-${index}`} className="flex justify-between gap-2 text-[9px]">
                <span className="truncate text-slate-300">{voter.displayName}</span>
                <span className="shrink-0 text-cyan-300">
                  {optionLabels.get(voter.optionId) || 'گزینه'}
                </span>
              </div>
            ))}
          </div>
        </details>
      )}
    </article>
  );
}
