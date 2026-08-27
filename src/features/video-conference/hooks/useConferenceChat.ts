import { useCallback, useEffect, useState } from 'react';
import type { ConferenceSupabaseClient } from '../../../components/VideoConference/conferenceClient';
import { loadConferenceMessages } from '../services/conferenceRealtime';
import type { ConferenceAuthorization, ConferenceMessageRow } from '../types/conference.types';
import { conferenceMessageRole, hasConferencePermission } from '../utils/conferencePermissions';

interface Params {
  client: ConferenceSupabaseClient;
  roomId: string;
  currentUserId: string;
  currentUserName: string;
  authorization: ConferenceAuthorization;
  phaseAllowsChat: boolean;
}

export function useConferenceChat({
  client,
  roomId,
  currentUserId,
  currentUserName,
  authorization,
  phaseAllowsChat,
}: Params) {
  const [messages, setMessages] = useState<ConferenceMessageRow[]>([]);
  const [message, setMessage] = useState('');
  const canSend = (
    phaseAllowsChat
    && hasConferencePermission(authorization, 'SEND_CHAT')
  );

  const refreshMessages = useCallback(async () => {
    try {
      setMessages(await loadConferenceMessages(client, roomId));
    } catch (error) {
      console.error('[VideoConference] chat load failed', error);
    }
  }, [client, roomId]);

  useEffect(() => { void refreshMessages(); }, [refreshMessages]);

  const sendMessage = useCallback(async () => {
    const body = message.trim();
    if (!canSend || !body || body.length > 4000) return;

    setMessage('');
    const { error } = await client.from('conference_messages').insert({
      room_id: roomId,
      user_id: currentUserId,
      display_name: currentUserName.slice(0, 60),
      body,
      role: conferenceMessageRole(authorization.role),
    });
    if (error) {
      console.error('[VideoConference] chat send failed', error);
      setMessage(body);
    }
  }, [authorization.role, canSend, client, currentUserId, currentUserName, message, roomId]);

  return { messages, message, setMessage, refreshMessages, sendMessage, canSend };
}
