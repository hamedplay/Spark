import type { ConnectionQuality, LocalParticipant, RemoteParticipant, Room } from 'livekit-client';

export type ConferenceRole = 'host' | 'admin' | 'moderator' | 'member' | 'guest';
export type HostAction = 'remove' | 'mute' | 'promote' | 'demote' | 'lock' | 'unlock' | 'end' | 'lower-hand';
export type ConferenceUiState = 'joining' | 'waiting' | 'connected' | 'reconnecting' | 'failed';
export type ConferencePanel = 'chat' | 'private-chat' | 'moderator-chat' | 'polls' | 'whiteboard' | 'presentation' | 'participants' | 'devices' | null;
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
  'ACCESS_MODERATOR_CHAT',
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
  'MANAGE_PRESENTATIONS',
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

export type ConferenceModeratorChatAction =
  | 'send'
  | 'edit'
  | 'delete';

export type ConferencePollType =
  | 'SINGLE_CHOICE'
  | 'MULTIPLE_CHOICE'
  | 'YES_NO'
  | 'TRUE_FALSE';

export type ConferencePollResultVisibility =
  | 'LIVE'
  | 'AFTER_VOTE'
  | 'AFTER_CLOSE'
  | 'HIDDEN';

export type ConferencePollStatus = 'DRAFT' | 'OPEN' | 'CLOSED';

export type ConferencePollAction =
  | 'create'
  | 'open'
  | 'close'
  | 'vote'
  | 'delete';

export interface ConferencePollOption {
  id: string;
  label: string;
  position: number;
  voteCount: number | null;
}

export interface ConferencePollVoter {
  userId: string;
  displayName: string;
  optionId: string;
}

export interface ConferencePollItem {
  id: string;
  roomId: string;
  createdBy: string;
  question: string;
  pollType: ConferencePollType;
  anonymous: boolean;
  resultVisibility: ConferencePollResultVisibility;
  status: ConferencePollStatus;
  timeLimitSeconds: number | null;
  openedAt: string | null;
  closesAt: string | null;
  endedAt: string | null;
  createdAt: string;
  revision: number;
  canManage: boolean;
  canVote: boolean;
  hasVoted: boolean;
  resultsVisible: boolean;
  totalVoters: number | null;
  mySelectedOptionIds: string[];
  options: ConferencePollOption[];
  voters: ConferencePollVoter[];
}

export interface ConferencePollSnapshot {
  loaded: boolean;
  serverTime: string;
  canCreate: boolean;
  canVote: boolean;
  polls: ConferencePollItem[];
}

export type ConferenceWhiteboardElementType =
  | 'pen'
  | 'marker'
  | 'line'
  | 'arrow'
  | 'rectangle'
  | 'circle'
  | 'text'
  | 'sticky'
  | 'image';

export type ConferenceWhiteboardTool =
  | ConferenceWhiteboardElementType
  | 'eraser'
  | 'laser'
  | 'pan';

export interface ConferenceWhiteboardPoint {
  x: number;
  y: number;
}

export interface ConferenceWhiteboardElement {
  id: string;
  type: ConferenceWhiteboardElementType;
  points: ConferenceWhiteboardPoint[];
  color: string;
  width: number;
  text?: string;
  assetPath?: string;
  createdBy?: string;
  updatedAt?: string;
}

export interface ConferenceWhiteboardPage {
  id: string;
  title: string;
  position: number;
  revision: number;
  snapshot: {
    elements: ConferenceWhiteboardElement[];
  };
  updatedAt: string;
}

export interface ConferenceWhiteboardSnapshot {
  loaded: boolean;
  roomStatus: string;
  boardLocked: boolean;
  boardRevision: number;
  canUse: boolean;
  canManage: boolean;
  pages: ConferenceWhiteboardPage[];
  serverTime: string;
}

export interface ConferenceWhiteboardOperation {
  id: string;
  action:
    | 'upsert_element'
    | 'delete_element'
    | 'add_page'
    | 'delete_page'
    | 'rename_page'
    | 'clear_page'
    | 'lock'
    | 'unlock';
  roomId: string;
  pageId?: string;
  elementId?: string;
  element?: ConferenceWhiteboardElement;
  title?: string;
  position?: number;
  revision?: number;
  boardRevision?: number;
  boardLocked?: boolean;
  actorUserId: string;
  timestamp: string;
}

export interface ConferenceWhiteboardPresence {
  participantIdentity: string;
  displayName: string;
  pageId: string;
  x: number;
  y: number;
  laser: boolean;
  timestamp: number;
}


export type ConferencePresentationSourceKind = 'PDF' | 'IMAGE' | 'SLIDES' | 'DOCUMENT';
export type ConferencePresentationStatus = 'UPLOADING' | 'CONVERTING' | 'READY' | 'FAILED' | 'DELETED';

export interface ConferencePresentationItem {
  id: string;
  roomId: string;
  createdBy: string;
  title: string;
  originalFileName: string;
  sourceKind: ConferencePresentationSourceKind;
  sourceMimeType: string;
  sourcePath: string;
  renderedPath: string | null;
  renderedMimeType: string | null;
  status: ConferencePresentationStatus;
  fileSizeBytes: number;
  pageCount: number | null;
  conversionError: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
  canDelete: boolean;
}

export interface ConferencePresentationState {
  presentationId: string | null;
  presenterUserId: string | null;
  currentPage: number;
  isActive: boolean;
  revision: number;
  activatedAt: string | null;
  updatedAt: string | null;
}

export interface ConferencePresentationSnapshot {
  loaded: boolean;
  serverTime: string;
  canUpload: boolean;
  canManage: boolean;
  canAnnotate: boolean;
  annotatorUserIds: string[];
  state: ConferencePresentationState;
  presentations: ConferencePresentationItem[];
}

export interface ConferencePresentationPoint {
  x: number;
  y: number;
}

export interface ConferencePresentationAnnotationElement {
  id: string;
  type: 'pen' | 'marker' | 'line' | 'arrow' | 'rectangle' | 'circle' | 'text' | 'sticky';
  points: ConferencePresentationPoint[];
  color: string;
  width: number;
  text?: string;
  createdBy?: string;
  updatedAt?: string;
}

export interface ConferencePresentationAnnotationSnapshot {
  loaded: boolean;
  canAnnotate: boolean;
  revision: number;
  elements: ConferencePresentationAnnotationElement[];
  updatedAt: string | null;
}

export interface ConferencePresentationLaser {
  participantIdentity: string;
  displayName: string;
  presentationId: string;
  page: number;
  x: number;
  y: number;
  timestamp: number;
}

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

export interface ConferenceReactionEvent {
  id: string;
  reaction: string;
  participantIdentity: string;
  displayName: string;
  avatarUrl: string | null;
  timestamp: string;
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

export interface ConferenceModeratorMessageRow {
  id: string;
  room_id: string;
  sender_id: string;
  sender_name: string;
  body: string;
  reply_to_id: string | null;
  reply_to_body: string | null;
  reply_to_sender_name: string | null;
  is_deleted: boolean;
  edited_at: string | null;
  deleted_at: string | null;
  deleted_by: string | null;
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
  reactions: ConferenceReactionEvent[];
}
