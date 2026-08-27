import type { ConnectionQuality, LocalParticipant, RemoteParticipant, Room } from 'livekit-client';

export type ConferenceRole = 'host' | 'admin' | 'moderator' | 'member' | 'guest';
export type HostAction = 'remove' | 'mute' | 'promote' | 'demote' | 'lock' | 'unlock' | 'end' | 'lower-hand';
export type ConferenceUiState = 'joining' | 'waiting' | 'connected' | 'reconnecting' | 'failed';
export type ConferencePanel = 'chat' | 'participants' | 'devices' | null;
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

export interface ConferenceMessageRow {
  id: string;
  user_id: string;
  display_name: string;
  body: string;
  created_at: string | null;
  is_deleted: boolean;
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
