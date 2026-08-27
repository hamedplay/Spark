import type { ConnectionQuality, LocalParticipant, RemoteParticipant, Room } from 'livekit-client';

export type ConferenceRole = 'host' | 'admin' | 'moderator' | 'member' | 'guest';
export type HostAction = 'remove' | 'mute' | 'promote' | 'demote' | 'lock' | 'unlock' | 'end' | 'lower-hand';
export type ConferenceUiState = 'joining' | 'waiting' | 'connected' | 'reconnecting' | 'failed';
export type ConferencePanel = 'chat' | 'private-chat' | 'participants' | 'devices' | null;
export type ConferenceParticipant = LocalParticipant | RemoteParticipant;

export const CONFERENCE_RBAC_ROLES = [
  'OWNER',
  'HOST',
  'CO_HOST',
  'MODERATOR',
  'PRESENTER',
  'PARTICIPANT',
  'VIEWER',
] as const;

export type ConferenceRbacRole = typeof CONFERENCE_RBAC_ROLES[number];

export const CONFERENCE_PERMISSIONS = [
  'BAN_PARTICIPANT',
  'CREATE_POLL',
  'DELETE_CHAT',
  'DISABLE_CAMERA',
  'DISABLE_MIC',
  'END_MEETING',
  'JOIN_ROOM',
  'LOCK_ROOM',
  'MANAGE_BREAKOUTS',
  'MANAGE_CHAT',
  'MANAGE_POLLS',
  'MANAGE_PHASE',
  'MANAGE_ROLES',
  'MANAGE_TIMER',
  'MANAGE_WAITING_ROOM',
  'MANAGE_WHITEBOARD',
  'MUTE_OTHERS',
  'PIN_PARTICIPANT',
  'PUBLISH_CAMERA',
  'PUBLISH_MIC',
  'PUBLISH_SCREEN',
  'REMOVE_PARTICIPANT',
  'SEND_CHAT',
  'SEND_PRIVATE_CHAT',
  'SHARE_FILE',
  'START_BREAK',
  'START_RECORDING',
  'STOP_RECORDING',
  'SUBSCRIBE_MEDIA',
  'TRANSFER_OWNERSHIP',
  'USE_WHITEBOARD',
  'VOTE_POLL',
] as const;

export type ConferencePermission = typeof CONFERENCE_PERMISSIONS[number];

export type SpeakerSessionStatus =
  | 'QUEUED'
  | 'ACTIVE'
  | 'PAUSED'
  | 'EXPIRED'
  | 'CANCELLED'
  | 'COMPLETED';

export type SpeakerTimerAction =
  | 'start'
  | 'extend'
  | 'pause'
  | 'resume'
  | 'stop';

export type SpeakerQueueAction =
  | 'move_up'
  | 'move_down'
  | 'remove'
  | 'set_time'
  | 'allow';

export type ConferenceChatAction =
  | 'send'
  | 'edit'
  | 'delete'
  | 'react';

export type ConferencePrivateChatAction =
  | 'send'
  | 'edit'
  | 'delete'
  | 'read';

export type MeetingPhase =
  | 'SCHEDULED'
  | 'WAITING'
  | 'COUNTDOWN'
  | 'LIVE'
  | 'BREAK'
  | 'RESUMING'
  | 'ENDED';

export type ConferencePhaseAction =
  | 'open_waiting'
  | 'start_countdown'
  | 'start_break'
  | 'resume';

export interface ConferencePhasePolicy {
  allowMic: boolean;
  allowCamera: boolean;
  allowChat: boolean;
}

export interface ConferencePhaseSnapshot extends ConferencePhasePolicy {
  loaded: boolean;
  serverTime: string;
  currentPhase: MeetingPhase;
  phaseStartedAt: string;
  phaseEndsAt: string | null;
  revision: number;
  canManage: boolean;
}

export interface ConferenceAuthorization {
  loaded: boolean;
  role: ConferenceRbacRole | null;
  permissions: ConferencePermission[];
}

export interface ConferenceRoomShape {
  id: string;
  name: string;
  host_id: string;
  max_participants?: number;
  allow_reactions?: boolean;
  allow_screen_share?: boolean;
}

export interface WaitingRow {
  id: string;
  user_id: string;
  display_name: string;
  status: string;
  requested_at: string;
}

export interface ConferenceMessageReactionRow {
  user_id: string;
  emoji: string;
  created_at: string;
}

export interface ConferenceMessageRow {
  id: string;
  user_id: string;
  display_name: string;
  body: string;
  created_at: string | null;
  reply_to_id: string | null;
  reply_to_body: string | null;
  reply_to_name: string | null;
  edited_at: string | null;
  deleted_at: string | null;
  deleted_by: string | null;
  is_deleted: boolean;
  reactions: ConferenceMessageReactionRow[];
  mentioned_user_ids: string[];
}

export interface ConferencePrivateMessageRow {
  id: string;
  room_id: string;
  sender_id: string;
  recipient_id: string;
  sender_name: string;
  recipient_name: string;
  body: string;
  reply_to_id: string | null;
  reply_to_body: string | null;
  reply_to_sender_name: string | null;
  is_deleted: boolean;
  edited_at: string | null;
  deleted_at: string | null;
  deleted_by: string | null;
  read_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ParticipantRow {
  user_id: string;
  display_name: string;
  role: ConferenceRbacRole;
  is_muted: boolean;
  is_hand_raised: boolean;
  hand_raised_at: string | null;
  status: string;
}

export interface RecordingRow {
  id: string;
  status: string;
  created_at: string;
}

export interface SpeakerSessionRow {
  id: string;
  room_id: string;
  user_id: string;
  granted_by: string;
  starts_at: string;
  active_started_at: string | null;
  expires_at: string | null;
  allocated_seconds: number;
  used_seconds: number;
  status: SpeakerSessionStatus;
  queue_position: number | null;
  paused_at: string | null;
  ended_at: string | null;
  end_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface SpeakerTimerSnapshot {
  loaded: boolean;
  serverTime: string;
  canManage: boolean;
  sessions: SpeakerSessionRow[];
}

export interface SpeakerQueueItem {
  participant: ParticipantRow;
  session: SpeakerSessionRow;
}

export interface ConferencePhaseController extends ConferencePhaseSnapshot {
  remainingSeconds: number | null;
  mediaHidden: boolean;
  busy: boolean;
  refresh: () => Promise<void>;
  runAction: (
    action: ConferencePhaseAction,
    durationSeconds?: number,
    policy?: ConferencePhasePolicy,
  ) => Promise<unknown>;
}

export interface ConferenceSpeakerTimerController {
  sessionsByUser: Record<string, SpeakerSessionRow>;
  remainingByUser: Record<string, number>;
  runAction: (
    targetUserId: string,
    action: SpeakerTimerAction,
    seconds?: number,
  ) => Promise<unknown>;
  refresh: () => Promise<void>;
}

export interface MediaDeviceOption {
  deviceId: string;
  label: string;
}

export interface ConferenceToolsProps {
  room: Room;
  roomId: string;
  currentUserId: string;
  currentUserName: string;
  authorization: ConferenceAuthorization;
  phase: ConferencePhaseController;
  speakerTimer: ConferenceSpeakerTimerController;
  onEnded: () => void;
}

export interface ConferenceStateSnapshot {
  uiState: ConferenceUiState;
  errorMessage: string;
  role: ConferenceRole;
  revision: number;
  quality: ConnectionQuality | 'unknown';
  activeSpeakerIdentity: string | null;
  reaction: string | null;
}
