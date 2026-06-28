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
  allow_reactions: boolean;
  allow_screen_share: boolean;
  allow_chat: boolean;
  chat_enabled: boolean;
  record_enabled: boolean;
  meeting_id: string | null;
  created_at: string;
  ended_at: string | null;
  expires_at: string | null;
  speaking_limit_enabled: boolean;
}

export interface ConferenceParticipant {
  id: string;
  room_id: string;
  user_id: string;
  display_name: string;
  role: 'host' | 'admin' | 'moderator' | 'member' | 'guest';
  status: 'waiting' | 'joined' | 'left';
  joined_at: string | null;
  left_at: string | null;
  is_muted: boolean;
  is_video_off: boolean;
  is_hand_raised: boolean;
  peer_id: string;
  speaking_seconds: number;
  network_quality: 'excellent' | 'good' | 'fair' | 'poor';
  created_at: string;
}

export interface ConferenceMessage {
  id: string;
  room_id: string;
  user_id: string;
  display_name: string;
  body: string;
  image_url?: string | null;
  created_at: string;
  role?: 'admin' | 'moderator' | 'user' | 'system';
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
  ended_at?: string | null;
  votes?: Record<number, number>;
  my_vote?: number | null;
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

export interface PeerConnection {
  peerId: string;
  userId: string;
  displayName: string;
  pc: RTCPeerConnection;
  stream: MediaStream | null;
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
  x: number;
  y: number;
  createdAt: number;
  expiresAt?: number;
}

export type SidePanel = 'chat' | 'participants' | 'polls' | 'whiteboard' | 'settings' | null;
export type LayoutMode = 'gallery' | 'speaker' | 'sidebar';
