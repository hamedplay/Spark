import { resolveWaitingParticipant } from '../../services/conferenceApi';
import type { WaitingRow } from '../../types/conference.types';

export function WaitingRoomList({ roomId, rows }: { roomId: string; rows: WaitingRow[] }) {
  if (rows.length === 0) return null;

  return (
    <div className="max-h-40 overflow-y-auto border-b border-white/10 bg-slate-900/95 p-2">
      {rows.map((row) => (
        <div key={row.id} className="flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-sm">
          <span className="truncate">{row.display_name || 'شرکت‌کننده'}</span>
          <div className="flex gap-2">
            <button onClick={() => void resolveWaitingParticipant(roomId, row.user_id, true)} className="min-h-10 rounded-lg bg-emerald-600 px-3">پذیرش</button>
            <button onClick={() => void resolveWaitingParticipant(roomId, row.user_id, false)} className="min-h-10 rounded-lg bg-rose-600 px-3">رد</button>
          </div>
        </div>
      ))}
    </div>
  );
}
