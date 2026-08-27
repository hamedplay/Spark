import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '../../../lib/supabase';
import type { Database } from '../../../types/supabase';
import type { ConferenceRbacRole, ConferenceRole, HostAction } from '../types/conference.types';

export type { ConferenceRole, HostAction } from '../types/conference.types';

type ConferenceClient = SupabaseClient<Database>;

export type LiveKitPublishSource = 'camera' | 'microphone' | 'screen_share' | 'screen_share_audio';

export interface LiveKitMediaPolicy {
  canPublish: boolean;
  canSubscribe: boolean;
  canPublishData: boolean;
  publishSources: LiveKitPublishSource[];
}

export interface LiveKitTokenResponse {
  token: string;
  serverUrl: string;
  roomName: string;
  role: ConferenceRole;
  rbacRole: ConferenceRbacRole;
  livekitPolicy: LiveKitMediaPolicy;
  maxParticipants: number;
  expiresInSeconds: number;
}

export type LiveKitJoinState =
  | { status: 'ready'; data: LiveKitTokenResponse }
  | { status: 'waiting' }
  | { status: 'rejected'; reason: string };

export async function requestLiveKitToken(roomId: string, client: ConferenceClient = supabase): Promise<LiveKitJoinState> {
  const { data, error } = await client.functions.invoke('conference-livekit-token', { body: { roomId } });

  if (!error && data?.token && data?.serverUrl) return { status: 'ready', data: data as LiveKitTokenResponse };
  if (!error && (data?.reason === 'waiting_for_admission' || data?.error === 'WAITING_FOR_ADMISSION')) return { status: 'waiting' };

  const context = (error as { context?: Response } | null)?.context;
  if (context) {
    try {
      const payload = await context.clone().json();
      if (payload?.reason === 'waiting_for_admission' || payload?.error === 'WAITING_FOR_ADMISSION') return { status: 'waiting' };
      return { status: 'rejected', reason: String(payload?.reason || payload?.error || 'TOKEN_FAILED') };
    } catch {
      // Fall through to generic failure.
    }
  }

  return { status: 'rejected', reason: String(data?.reason || data?.error || error?.message || 'TOKEN_FAILED') };
}

export async function createMeetingConference(meetingId: string) {
  const { data, error } = await supabase.rpc('create_meeting_livekit_conference', { p_meeting_id: meetingId });
  if (error) throw error;
  if (!data?.ok || !data?.room) throw new Error(String(data?.reason || 'ROOM_CREATE_FAILED'));
  return data.room;
}

export async function resolveWaitingParticipant(roomId: string, userId: string, admit: boolean) {
  const { data, error } = await supabase.rpc('admit_livekit_conference_participant', {
    p_room_id: roomId,
    p_target_user_id: userId,
    p_admit: admit,
  });
  if (error) throw error;
  if (!data?.ok) throw new Error(String(data?.reason || 'WAITING_ROOM_UPDATE_FAILED'));
  return data;
}

export async function setRaiseHand(roomId: string, raised: boolean, client: ConferenceClient = supabase) {
  const { data, error } = await client.rpc('set_livekit_raise_hand', { p_room_id: roomId, p_raised: raised });
  if (error) throw error;
  if (!data?.ok) throw new Error(String(data?.reason || 'RAISE_HAND_FAILED'));
  return data;
}

export async function runHostAction(roomId: string, action: HostAction, targetUserId?: string, client: ConferenceClient = supabase) {
  const { data, error } = await client.functions.invoke('conference-host-control', {
    body: { roomId, action, targetUserId },
  });
  if (error || !data?.ok) throw new Error(String(data?.error || error?.message || 'HOST_ACTION_FAILED'));
  return data;
}

export async function setRecording(roomId: string, action: 'start' | 'stop', client: ConferenceClient = supabase) {
  const { data, error } = await client.functions.invoke('conference-recording', { body: { roomId, action } });
  if (error || !data?.ok) throw new Error(String(data?.error || error?.message || 'RECORDING_FAILED'));
  return data;
}
