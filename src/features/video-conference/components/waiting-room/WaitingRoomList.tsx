import { Loader2, UserCheck, UserX, Users } from 'lucide-react';
import { useState } from 'react';
import { useConferenceClient } from '../../../../components/VideoConference/conferenceClient';
import {
  admitAllWaitingParticipants,
  resolveWaitingParticipant,
} from '../../services/conferenceApi';
import type { WaitingRow } from '../../types/conference.types';

interface Props {
  roomId: string;
  rows: WaitingRow[];
  onChanged: () => Promise<void>;
}

const errorLabels: Record<string, string> = {
  room_full: 'ظرفیت جلسه برای پذیرش فرد جدید تکمیل شده است.',
  request_expired: 'این درخواست منقضی شده است.',
  already_rejected: 'این درخواست قبلاً رد شده است.',
  already_admitted: 'این درخواست قبلاً پذیرفته شده است.',
  concurrent_resolution: 'این درخواست هم‌زمان توسط مدیر دیگری تعیین تکلیف شد.',
};

export function WaitingRoomList({ roomId, rows, onChanged }: Props) {
  const client = useConferenceClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState('');

  if (rows.length === 0) return null;

  const runSingle = async (row: WaitingRow, admit: boolean) => {
    const key = `${admit ? 'admit' : 'reject'}:${row.user_id}`;
    setBusy(key);
    setErrorMessage('');
    try {
      await resolveWaitingParticipant(roomId, row.user_id, admit, client);
      await onChanged();
    } catch (error) {
      const code = error instanceof Error
        ? error.message
        : 'WAITING_ROOM_UPDATE_FAILED';
      setErrorMessage(
        errorLabels[code.toLowerCase()]
        || 'تعیین تکلیف درخواست ورود انجام نشد.',
      );
      await onChanged();
    } finally {
      setBusy(null);
    }
  };

  const admitAll = async () => {
    setBusy('admit-all');
    setErrorMessage('');
    try {
      const result = await admitAllWaitingParticipants(roomId, client);
      if ((result.remaining_waiting_count || 0) > 0) {
        setErrorMessage('بخشی از درخواست‌ها به دلیل ظرفیت باقی ماندند.');
      }
      await onChanged();
    } catch (error) {
      const code = error instanceof Error
        ? error.message
        : 'WAITING_ROOM_BULK_UPDATE_FAILED';
      setErrorMessage(
        errorLabels[code.toLowerCase()]
        || 'پذیرش گروهی انجام نشد.',
      );
      await onChanged();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="border-b border-white/10 bg-slate-900/95 p-2" dir="rtl">
      <div className="mb-2 flex items-center justify-between gap-2 px-2">
        <div className="flex items-center gap-2 text-xs font-bold text-amber-200">
          <Users className="h-4 w-4" />
          در انتظار ورود ({rows.length})
        </div>
        <button
          type="button"
          onClick={() => void admitAll()}
          disabled={busy !== null}
          className="flex min-h-9 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-xs font-bold text-white disabled:opacity-50"
        >
          {busy === 'admit-all'
            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
            : <UserCheck className="h-3.5 w-3.5" />}
          پذیرش همه
        </button>
      </div>

      {errorMessage && (
        <div
          className="mx-2 mb-2 rounded-lg border border-rose-400/25 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-100"
          aria-live="assertive"
        >
          {errorMessage}
        </div>
      )}

      <div className="max-h-44 overflow-y-auto">
        {rows.map((row) => (
          <div
            key={row.id}
            className="flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-sm"
          >
            <span className="truncate">
              {row.display_name || 'شرکت‌کننده'}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void runSingle(row, true)}
                disabled={busy !== null}
                className="flex min-h-10 items-center gap-1 rounded-lg bg-emerald-600 px-3 text-xs font-bold disabled:opacity-50"
              >
                {busy === `admit:${row.user_id}`
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <UserCheck className="h-3.5 w-3.5" />}
                پذیرش
              </button>
              <button
                type="button"
                onClick={() => void runSingle(row, false)}
                disabled={busy !== null}
                className="flex min-h-10 items-center gap-1 rounded-lg bg-rose-600 px-3 text-xs font-bold disabled:opacity-50"
              >
                {busy === `reject:${row.user_id}`
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <UserX className="h-3.5 w-3.5" />}
                رد
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
