import type { ChangeEvent } from 'react';
import { Hand, MicOff, UserMinus } from 'lucide-react';
import type {
  ConferenceRbacRole,
  HostAction,
  ParticipantRow,
  SpeakerSessionRow,
  SpeakerTimerAction,
} from '../../types/conference.types';
import { ASSIGNABLE_CONFERENCE_ROLES, conferenceRoleLabel } from '../../utils/conferencePermissions';
import { SpeakerTimerControl } from './SpeakerTimerControl';

interface Props {
  participants: ParticipantRow[];
  currentUserId: string;
  canMuteOthers: boolean;
  canRemoveParticipants: boolean;
  canManageRoles: boolean;
  canManageTimer: boolean;
  speakerSessionsByUser: Record<string, SpeakerSessionRow>;
  speakerRemainingByUser: Record<string, number>;
  timerBusy: string | null;
  onHostAction: (action: HostAction, targetUserId?: string) => Promise<void>;
  onRoleChange: (targetUserId: string, role: ConferenceRbacRole) => Promise<void>;
  onTimerAction: (
    targetUserId: string,
    action: SpeakerTimerAction,
    seconds?: number,
  ) => Promise<void>;
}

export function ConferenceParticipantsPanel({
  participants,
  currentUserId,
  canMuteOthers,
  canRemoveParticipants,
  canManageRoles,
  canManageTimer,
  speakerSessionsByUser,
  speakerRemainingByUser,
  timerBusy,
  onHostAction,
  onRoleChange,
  onTimerAction,
}: Props) {
  return (
    <div className="max-h-[48dvh] overflow-y-auto p-2">
      {participants.map((participant) => {
        const canTarget = participant.user_id !== currentUserId && participant.role !== 'OWNER';
        const canTimeSpeaker = canTarget && canManageTimer && participant.role !== 'VIEWER';
        return (
          <div key={participant.user_id} className="rounded-xl px-3 py-2 hover:bg-white/5">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-semibold">{participant.display_name || 'شرکت‌کننده'}</span>
                  {participant.is_hand_raised && <Hand className="h-4 w-4 text-amber-400" />}
                  {participant.is_muted && <MicOff className="h-4 w-4 text-slate-400" />}
                </div>
                <span className="text-[10px] text-slate-400">{conferenceRoleLabel(participant.role)}</span>
              </div>

              {canTarget && (
                <div className="flex shrink-0 items-center gap-1">
                  {canMuteOthers && <button onClick={() => void onHostAction('mute', participant.user_id)} className="h-9 rounded-lg bg-slate-800 px-2 text-[10px]">قطع صدا</button>}
                  {canMuteOthers && participant.is_hand_raised && <button onClick={() => void onHostAction('lower-hand', participant.user_id)} className="h-9 rounded-lg bg-slate-800 px-2 text-[10px]">پایین دست</button>}
                  {canManageRoles && (
                    <select
                      value={participant.role}
                      onChange={(event: ChangeEvent<HTMLSelectElement>) => void onRoleChange(participant.user_id, event.target.value as ConferenceRbacRole)}
                      className="h-9 rounded-lg border border-white/10 bg-slate-800 px-2 text-[10px]"
                      aria-label="نقش شرکت‌کننده"
                    >
                      {ASSIGNABLE_CONFERENCE_ROLES.map((role) => <option key={role} value={role}>{conferenceRoleLabel(role)}</option>)}
                    </select>
                  )}
                  {canRemoveParticipants && <button onClick={() => void onHostAction('remove', participant.user_id)} className="flex h-9 w-9 items-center justify-center rounded-lg bg-rose-700" aria-label="حذف شرکت‌کننده"><UserMinus className="h-4 w-4" /></button>}
                </div>
              )}
            </div>

            {canTimeSpeaker && (
              <SpeakerTimerControl
                userId={participant.user_id}
                session={speakerSessionsByUser[participant.user_id]}
                remainingSeconds={speakerRemainingByUser[participant.user_id]}
                busy={Boolean(timerBusy?.startsWith(`timer:${participant.user_id}:`))}
                onAction={onTimerAction}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
