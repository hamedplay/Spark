import { Hand, MicOff, UserMinus } from 'lucide-react';
import type { HostAction, ParticipantRow } from '../../types/conference.types';

interface Props {
  participants: ParticipantRow[];
  currentUserId: string;
  isManager: boolean;
  onHostAction: (action: HostAction, targetUserId?: string) => Promise<void>;
}

export function ConferenceParticipantsPanel({ participants, currentUserId, isManager, onHostAction }: Props) {
  return (
    <div className="max-h-[48dvh] overflow-y-auto p-2">
      {participants.map((participant) => (
        <div key={participant.user_id} className="flex items-center justify-between gap-2 rounded-xl px-3 py-2 hover:bg-white/5">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-semibold">{participant.display_name || 'شرکت‌کننده'}</span>
              {participant.is_hand_raised && <Hand className="h-4 w-4 text-amber-400" />}
              {participant.is_muted && <MicOff className="h-4 w-4 text-slate-400" />}
            </div>
            <span className="text-[10px] text-slate-400">{participant.role === 'host' ? 'میزبان' : participant.role === 'admin' ? 'هم‌میزبان' : participant.role === 'moderator' ? 'مدیر جلسه' : 'شرکت‌کننده'}</span>
          </div>
          {isManager && participant.user_id !== currentUserId && (
            <div className="flex shrink-0 items-center gap-1">
              <button onClick={() => void onHostAction('mute', participant.user_id)} className="h-9 rounded-lg bg-slate-800 px-2 text-[10px]">قطع صدا</button>
              {participant.is_hand_raised && <button onClick={() => void onHostAction('lower-hand', participant.user_id)} className="h-9 rounded-lg bg-slate-800 px-2 text-[10px]">پایین دست</button>}
              <button onClick={() => void onHostAction(participant.role === 'admin' ? 'demote' : 'promote', participant.user_id)} className="h-9 rounded-lg bg-slate-800 px-2 text-[10px]">{participant.role === 'admin' ? 'عادی' : 'هم‌میزبان'}</button>
              <button onClick={() => void onHostAction('remove', participant.user_id)} className="flex h-9 w-9 items-center justify-center rounded-lg bg-rose-700" aria-label="حذف شرکت‌کننده"><UserMinus className="h-4 w-4" /></button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
