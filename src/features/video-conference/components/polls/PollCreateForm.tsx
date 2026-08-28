import { useMemo, useState } from 'react';
import { Loader2, Plus, X } from 'lucide-react';
import type {
  ConferencePollResultVisibility,
  ConferencePollType,
} from '../../types/conference.types';

interface CreateInput {
  question: string;
  pollType: ConferencePollType;
  options: string[];
  anonymous: boolean;
  resultVisibility: ConferencePollResultVisibility;
  timeLimitSeconds: number | null;
  openImmediately: boolean;
}

interface Props {
  busy: boolean;
  errorMessage: string;
  onCreate: (input: CreateInput) => Promise<boolean>;
}

const TYPE_LABELS: Record<ConferencePollType, string> = {
  SINGLE_CHOICE: 'تک‌انتخابی',
  MULTIPLE_CHOICE: 'چندانتخابی',
  YES_NO: 'بله / خیر',
  TRUE_FALSE: 'درست / نادرست',
};

const VISIBILITY_LABELS: Record<ConferencePollResultVisibility, string> = {
  LIVE: 'نتیجه زنده',
  AFTER_VOTE: 'بعد از رأی خودم',
  AFTER_CLOSE: 'بعد از بسته‌شدن',
  HIDDEN: 'فقط مدیران',
};

export function PollCreateForm({ busy, errorMessage, onCreate }: Props) {
  const [question, setQuestion] = useState('');
  const [pollType, setPollType] = useState<ConferencePollType>('SINGLE_CHOICE');
  const [options, setOptions] = useState(['', '']);
  const [anonymous, setAnonymous] = useState(false);
  const [resultVisibility, setResultVisibility] =
    useState<ConferencePollResultVisibility>('LIVE');
  const [timeLimit, setTimeLimit] = useState('');
  const [openImmediately, setOpenImmediately] = useState(true);

  const customOptions = pollType === 'SINGLE_CHOICE' || pollType === 'MULTIPLE_CHOICE';
  const preparedOptions = useMemo(
    () => options.map((item) => item.trim()).filter(Boolean),
    [options],
  );
  const valid = question.trim().length > 0
    && question.trim().length <= 500
    && (
      !customOptions
      || (
        preparedOptions.length >= 2
        && preparedOptions.length <= 10
        && new Set(preparedOptions.map((item) => item.toLocaleLowerCase())).size
          === preparedOptions.length
      )
    )
    && (
      !timeLimit
      || (
        Number.isInteger(Number(timeLimit))
        && Number(timeLimit) >= 10
        && Number(timeLimit) <= 86400
      )
    );

  const submit = async () => {
    if (!valid || busy) return;
    const ok = await onCreate({
      question: question.trim(),
      pollType,
      options: customOptions ? preparedOptions : [],
      anonymous,
      resultVisibility,
      timeLimitSeconds: timeLimit ? Number(timeLimit) : null,
      openImmediately,
    });
    if (!ok) return;

    setQuestion('');
    setPollType('SINGLE_CHOICE');
    setOptions(['', '']);
    setAnonymous(false);
    setResultVisibility('LIVE');
    setTimeLimit('');
    setOpenImmediately(true);
  };

  return (
    <section className="space-y-3 rounded-xl border border-white/10 bg-slate-950/50 p-3">
      <textarea
        value={question}
        onChange={(event) => setQuestion(event.target.value)}
        maxLength={500}
        rows={2}
        placeholder="سؤال نظرسنجی"
        className="w-full resize-none rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm outline-none focus:border-cyan-500"
      />

      <div className="grid grid-cols-2 gap-2">
        <select
          value={pollType}
          onChange={(event) => setPollType(event.target.value as ConferencePollType)}
          className="rounded-lg border border-white/10 bg-slate-900 px-2 py-2 text-xs"
        >
          {Object.entries(TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <select
          value={resultVisibility}
          onChange={(event) =>
            setResultVisibility(event.target.value as ConferencePollResultVisibility)}
          className="rounded-lg border border-white/10 bg-slate-900 px-2 py-2 text-xs"
        >
          {Object.entries(VISIBILITY_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </div>

      {customOptions ? (
        <div className="space-y-1.5">
          {options.map((option, index) => (
            <div key={index} className="flex items-center gap-1.5">
              <input
                value={option}
                maxLength={240}
                onChange={(event) => setOptions((current) =>
                  current.map((item, itemIndex) =>
                    itemIndex === index ? event.target.value : item
                  )
                )}
                placeholder={`گزینه ${index + 1}`}
                className="min-w-0 flex-1 rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-xs outline-none focus:border-cyan-500"
              />
              {options.length > 2 && (
                <button
                  type="button"
                  onClick={() => setOptions((current) =>
                    current.filter((_, itemIndex) => itemIndex !== index)
                  )}
                  className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-white/10"
                  aria-label="حذف گزینه"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}
          {options.length < 10 && (
            <button
              type="button"
              onClick={() => setOptions((current) => [...current, ''])}
              className="flex items-center gap-1 text-[10px] text-cyan-300"
            >
              <Plus className="h-3 w-3" /> افزودن گزینه
            </button>
          )}
        </div>
      ) : (
        <p className="text-[10px] text-slate-400">
          گزینه‌ها به‌صورت server-side برای این نوع ساخته می‌شوند.
        </p>
      )}

      <div className="grid grid-cols-2 gap-2">
        <label className="flex items-center gap-2 rounded-lg bg-slate-900 px-2 py-2 text-[10px]">
          <input
            type="checkbox"
            checked={anonymous}
            onChange={(event) => setAnonymous(event.target.checked)}
          />
          رأی‌گیری ناشناس
        </label>
        <label className="flex items-center gap-2 rounded-lg bg-slate-900 px-2 py-2 text-[10px]">
          <input
            type="checkbox"
            checked={openImmediately}
            onChange={(event) => setOpenImmediately(event.target.checked)}
          />
          باز شدن فوری
        </label>
      </div>

      <label className="block text-[10px] text-slate-400">
        محدودیت زمان (ثانیه، اختیاری)
        <input
          type="number"
          min={10}
          max={86400}
          value={timeLimit}
          onChange={(event) => setTimeLimit(event.target.value)}
          className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-xs text-white outline-none focus:border-cyan-500"
        />
      </label>

      {errorMessage && <p className="text-[10px] text-rose-300">{errorMessage}</p>}

      <button
        type="button"
        disabled={!valid || busy}
        onClick={() => void submit()}
        className="flex min-h-10 w-full items-center justify-center gap-2 rounded-xl bg-cyan-600 text-xs font-bold disabled:opacity-50"
      >
        {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        ایجاد نظرسنجی
      </button>
    </section>
  );
}
