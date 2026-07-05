// Naming convention:
//   snake_case — DB entity fields (mirrors Supabase column names)
//   camelCase  — client-only/runtime fields (PeerConnection, Reaction, etc.)

// ── Shared role type ──────────────────────────────────────────────────────────
// Used by ConferenceParticipant and (for display context) ConferenceMessage.
// "system" is message-only — never appears on a participant row.
export type ConferenceRole = 'host' | 'admin' | 'moderator' | 'member' | 'guest';
export type MessageRole = ConferenceRole | 'system';

// ── WebRTC signaling message types ───────────────────────────────────────────
export type SignalType =
  | 'offer' | 'answer' | 'ice' | 'renegotiate'
  | 'join' | 'leave' | 'peer_left' | 'end'
  | 'state' | 'host_mute_all' | 'lower_hand'
  | 'host_transfer' | 'kick' | 'role_change'
  | 'chat' | 'chat_toggle' | 'reaction'
  | 'speaking_limit_change';

// ── DB entities (snake_case) ──────────────────────────────────────────────────

export interface ConferenceRoom {
  id: string;
  name: string;
  code: string;
  host_id: string;
  status: 'waiting' | 'active' | 'ended';
  max_participants: number;
  is_locked: boolean;
  password: string | null;
  waiting_room_enabled: boolean;
  // allow_* = feature is permitted for this room (set at creation)
  allow_reactions: boolean;
  allow_screen_share: boolean;
  // chat_enabled = feature is currently active (toggled at runtime by host)
  // allow_chat is kept as an alias for backward-compat with older DB rows;
  // prefer chat_enabled for runtime checks.
  allow_chat: boolean;
  chat_enabled: boolean;
  record_enabled: boolean;
  speaking_limit_enabled: boolean;
  require_approval: boolean;
  meeting_id: string | null;
  created_at: string;       // ISO 8601
  ended_at: string | null;  // ISO 8601
  expires_at: string | null; // ISO 8601
}

export interface ConferenceParticipant {
  id: string;
  room_id: string;
  user_id: string;
  display_name: string;
  role: ConferenceRole;
  status: 'waiting' | 'joined' | 'left';
  joined_at: string | null;  // ISO 8601
  left_at: string | null;    // ISO 8601
  is_muted: boolean;
  is_video_off: boolean;
  is_hand_raised: boolean;
  is_screen_sharing: boolean;
  peer_id: string;
  speaking_seconds: number;
  network_quality: 'excellent' | 'good' | 'fair' | 'poor';
  created_at: string; // ISO 8601
}

export interface ConferenceMessage {
  id: string;
  room_id: string;
  user_id: string;
  display_name: string;
  body: string;
  image_url?: string | null;
  created_at: string; // ISO 8601
  role?: MessageRole;
  reply_to_id?: string | null;
  reply_to_body?: string | null;
  reply_to_name?: string | null;
  is_deleted?: boolean;
}

export interface ConferencePoll {
  id: string;
  room_id: string;
  created_by: string;
  question: string;
  options: string[];
  is_active: boolean;
  ended_at?: string | null; // ISO 8601
  votes?: Record<number, number>;
  my_vote?: number | null;
}

// ── Client-side / runtime entities (camelCase) ────────────────────────────────

export interface PeerConnection {
  peerId: string;
  userId: string;
  displayName: string;
  pc: RTCPeerConnection;
  /** Camera / mic stream received from the remote peer */
  stream: MediaStream | null;
  /** Screen-share stream received from the remote peer (separate track) */
  screenStream: MediaStream | null;
  isScreenSharing: boolean;
  isMuted: boolean;
  isVideoOff: boolean;
  isHandRaised: boolean;
  connectionState: RTCPeerConnectionState;
  networkQuality: 'excellent' | 'good' | 'fair' | 'poor';
  speakingSeconds: number;
  audioLevel: number;
}

export interface Reaction {
  id: string;
  userId: string;
  displayName: string;
  emoji: string;
  /** Floating-animation position (0–100 %) */
  x: number;
  y: number;
  /** Unix epoch milliseconds — intentionally a number for cheap comparisons */
  createdAt: number;
  /** Unix epoch milliseconds — required for automatic cleanup */
  expiresAt: number;
}

export interface WhiteboardStroke {
  id: string;
  userId: string;
  points: Point[];
  color: string;
  width: number;
  tool: 'pen' | 'eraser' | 'line' | 'rect' | 'circle' | 'arrow' | 'text';
  text?: string;
}

export interface Point {
  x: number;
  y: number;
}

export type SidePanel = 'chat' | 'participants' | 'polls' | 'whiteboard' | 'settings' | 'diagnostics' | null;
export type LayoutMode = 'gallery' | 'speaker' | 'sidebar';

// ── Approval system ───────────────────────────────────────────────────────────
export interface PendingApproval {
  id: string;
  room_id: string;
  user_id: string;
  display_name: string;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;  // ISO 8601
  expires_at: string;  // ISO 8601
  approved_by: string | null;
}
