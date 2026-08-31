import type { ChangeEvent } from 'react';
import { Camera, CameraOff, Hand, Mic, MicOff, MonitorUp, MonitorX, Star, StarOff, UserMinus } from 'lucide-react';
import type {
  ConferencePhaseController,
  ConferenceRbacRole,
  HostAction,
  ParticipantRow,
  SpeakerQueueAction,
  SpeakerQueueItem,
  SpeakerSessionRow,
  SpeakerTimerAction,
} from '../../types/conference.types';
import { ASSIGNABLE_CONFERENCE_ROLES, conferenceRoleLabel } from '../../utils/conferencePermissions';
import { MeetingPhaseControls } from '../controls/MeetingPhaseControls';
import { SpeakerQueuePanel } from './SpeakerQueuePanel';
import { SpeakerTimerControl } from './SpeakerTimerControl';

interface Props {
  participants: ParticipantRow[];
  currentUserId: string;
  phase: ConferencePhaseController;
  canMuteOthers: boolean;
  canDisableMic: boolean;
  canDisableCamera: boolean;
  canDisableScreen: boolean;
  canRemoveParticipants: boolean;
  canManageRoles: boolean;
  canManageTimer: boolean;
  canSpotlight: boolean;
  spotlightedUserIds: string[];
  spotlightBusy: string | null;
  spotlightErrorMessage: string;
  speakerQueue: SpeakerQueueItem[];
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
  onQueueAction: (
    targetUserId: string,
    action: SpeakerQueueAction,
    seconds?: number,
  ) => Promise<void>;
  onToggleSpotlight: (targetUserId: string) => Promise<boolean>;
  onClearSpotlights: () => Promise<boolean>;
}

export function ConferenceParticipantsPanel({
  participants,
  currentUserId,
  phase,
  canMuteOthers,
  canDisableMic,
  canDisableCamera,
  canDisableScreen,
  canRemoveParticipants,
  canManageRoles,
  canManageTimer,
  canSpotlight,
  spotlightedUserIds,
  spotlightBusy,
  spotlightErrorMessage,
  speakerQueue,
  speakerSessionsByUser,
  speakerRemainingByUser,
  timerBusy,
  onHostAction,
  onRoleChange,
  onTimerAction,
  onQueueAction,
  onToggleSpotlight,
  onClearSpotlights,
}: Props) {
  return (
    <div className="max-h-[48dvh] overflow-y-auto p-2">
      <MeetingPhaseControls phase={phase} />

      <SpeakerQueuePanel
        items={speakerQueue}
        canManage={canManageTimer}
        busy={timerBusy}
        onAction={onQueueAction}
      />

      {(spotlightedUserIds.length > 0 || spotlightErrorMessage) && (
        <div className="mx-2 mb-2 rounded-xl border border-amber-400/20 bg-amber-400/5 px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-bold text-amber-100">
              <Star className="h-4 w-4 fill-current" />
              {spotlightedUserIds.length} Spotlight فعال
            </div>
            {canSpotlight && spotlightedUserIds.length > 0 && (
              <button
                type="button"
                disabled={spotlightBusy !== null}
                onClick={() => void onClearSpotlights()}
                className="rounded-lg bg-slate-800 px-2 py-1.5 text-[10px] text-slate-100 disabled:opacity-50"
              >
                حذف همه
              </button>
            )}
          </div>
          {spotlightErrorMessage && (
            <div className="mt-2 text-[10px] leading-5 text-rose-200">
              {spotlightErrorMessage}
            </div>
          )}
        </div>
      )}

      {participants.map((participant) => {
        const canTarget = participant.user_id !== currentUserId && participant.role !== 'OWNER';
        const spotlighted = spotlightedUserIds.includes(participant.user_id);
        const speakerSession = speakerSessionsByUser[participant.user_id];
        const canTimeSpeaker = (
          canTarget
          && canManageTimer
          && participant.role !== 'VIEWER'
          && speakerSession?.status !== 'QUEUED'
        );

        return (
          <div key={participant.user_id} className="rounded-xl px-3 py-2 hover:bg-white/5">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-semibold">{participant.display_name || 'شرکت‌کننده'}</span>
                  {participant.is_hand_raised && <Hand className="h-4 w-4 text-amber-400" />}
                  {participant.is_muted && <MicOff className="h-4 w-4 text-slate-400" />}
                  {spotlighted && <Star className="h-4 w-4 fill-amber-300 text-amber-300" aria-label="Spotlight" />}
                </div>
                <span className="text-[10px] text-slate-400">{conferenceRoleLabel(participant.role)}</span>
              </div>

              {canSpotlight && (
                <button
                  type="button"
                  disabled={spotlightBusy !== null}
                  onClick={() => void onToggleSpotlight(participant.user_id)}
                  aria-label={spotlighted ? 'حذف Spotlight' : 'Spotlight کردن'}
                  aria-pressed={spotlighted}
                  className={
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg disabled:opacity-50 "
                    + (spotlighted
                      ? "bg-amber-500 text-slate-950"
                      : "bg-slate-800 text-amber-200")
                  }
                  title="Spotlight برای همه شرکت‌کنندگان جلسه اعمال می‌شود."
                >
                  {spotlighted
                    ? <StarOff className="h-4 w-4" />
                    : <Star className="h-4 w-4" />}
                </button>
              )}

              {canTarget && (
                <div className="flex shrink-0 items-center gap-1">
                  {canManageRoles && (
                    <select
                      value={participant.role}
                      onChange={(event: ChangeEvent<HTMLSelectElement>) => void onRoleChange(participant.user_id, event.target.value as ConferenceRbacRole)}
                      className="h-9 rounded-lg border border-white/10 bg-slate-800 px-2 text-[10px]"
                      aria-label="نقش شرکت‌کننده"
                    >
                      {ASSIGNABLE_CONFERENCE_ROLES.map((role) => (
                        <option key={role} value={role}>
                          {conferenceRoleLabel(role)}
                        </option>
                      ))}
                    </select>
                  )}
                  {canRemoveParticipants && (
                    <button
                      onClick={() => void onHostAction('remove', participant.user_id)}
                      className="flex h-9 w-9 items-center justify-center rounded-lg bg-rose-700"
                      aria-label="حذف شرکت‌کننده"
                    >
                      <UserMinus className="h-4 w-4" />
                    </button>
                  )}
                </div>
              )}
            </div>

            {canTarget && (
              canMuteOthers
              || canDisableMic
              || canDisableCamera
              || canDisableScreen
            ) && (
              <div className="mt-2 flex flex-wrap gap-1.5 border-t border-white/5 pt-2">
                {canMuteOthers && (
                  <button
                    type="button"
                    disabled={timerBusy !== null}
                    onClick={() => void onHostAction('mute', participant.user_id)}
                    className="flex min-h-9 items-center gap-1 rounded-lg bg-slate-800 px-2 text-[10px] disabled:opacity-50"
                    title="فقط Track میکروفون فعلی را mute می‌کند؛ مجوز انتشار را تغییر نمی‌دهد."
                  >
                    <MicOff className="h-3.5 w-3.5" />
                    Mute فعلی
                  </button>
                )}

                {canDisableMic && (
                  <button
                    type="button"
                    disabled={timerBusy !== null}
                    onClick={() => void onHostAction(
                      participant.mic_publishing_disabled
                        ? 'enable-mic'
                        : 'disable-mic',
                      participant.user_id,
                    )}
                    className={
                      "flex min-h-9 items-center gap-1 rounded-lg px-2 text-[10px] disabled:opacity-50 "
                      + (participant.mic_publishing_disabled
                        ? "bg-rose-900/60 text-rose-100"
                        : "bg-slate-800")
                    }
                  >
                    {participant.mic_publishing_disabled
                      ? <MicOff className="h-3.5 w-3.5" />
                      : <Mic className="h-3.5 w-3.5" />}
                    {participant.mic_publishing_disabled
                      ? 'میکروفون ممنوع'
                      : 'بستن میکروفون'}
                  </button>
                )}

                {canDisableCamera && (
                  <button
                    type="button"
                    disabled={timerBusy !== null}
                    onClick={() => void onHostAction(
                      participant.camera_publishing_disabled
                        ? 'enable-camera'
                        : 'disable-camera',
                      participant.user_id,
                    )}
                    className={
                      "flex min-h-9 items-center gap-1 rounded-lg px-2 text-[10px] disabled:opacity-50 "
                      + (participant.camera_publishing_disabled
                        ? "bg-rose-900/60 text-rose-100"
                        : "bg-slate-800")
                    }
                  >
                    {participant.camera_publishing_disabled
                      ? <CameraOff className="h-3.5 w-3.5" />
                      : <Camera className="h-3.5 w-3.5" />}
                    {participant.camera_publishing_disabled
                      ? 'دوربین ممنوع'
                      : 'بستن دوربین'}
                  </button>
                )}

                {canDisableScreen && (
                  <button
                    type="button"
                    disabled={timerBusy !== null}
                    onClick={() => void onHostAction(
                      participant.screen_publishing_disabled
                        ? 'enable-screen'
                        : 'disable-screen',
                      participant.user_id,
                    )}
                    className={
                      "flex min-h-9 items-center gap-1 rounded-lg px-2 text-[10px] disabled:opacity-50 "
                      + (participant.screen_publishing_disabled
                        ? "bg-rose-900/60 text-rose-100"
                        : "bg-slate-800")
                    }
                  >
                    {participant.screen_publishing_disabled
                      ? <MonitorX className="h-3.5 w-3.5" />
                      : <MonitorUp className="h-3.5 w-3.5" />}
                    {participant.screen_publishing_disabled
                      ? 'اشتراک صفحه ممنوع'
                      : 'بستن اشتراک صفحه'}
                  </button>
                )}

                {canMuteOthers && participant.is_hand_raised && (
                  <button
                    type="button"
                    disabled={timerBusy !== null}
                    onClick={() => void onHostAction(
                      'lower-hand',
                      participant.user_id,
                    )}
                    className="min-h-9 rounded-lg bg-slate-800 px-2 text-[10px] disabled:opacity-50"
                  >
                    پایین دست
                  </button>
                )}
              </div>
            )}

            {canTimeSpeaker && (
              <SpeakerTimerControl
                userId={participant.user_id}
                session={speakerSession}
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
