import type { ConnectionQuality, LocalParticipant, RemoteParticipant, Room } from 'livekit-client';

export type ConferenceRole = 'host' | 'admin' | 'moderator' | 'member' | 'guest';
export type HostAction = 'remove' | 'mute' | 'promote' | 'demote' | 'lock' | 'unlock' | 'end' | 'lower-hand';
export type ConferenceUiState = 'joining' | 'waiting' | 'connected' | 'reconnecting' | 'failed';
export type ConferencePanel = 'chat' | 'participants' | 'devices' | null;
export type ConferenceParticipant = LocalParticipant | RemoteParticipant;

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
  role: string;
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
  role: ConferenceRole;
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
