import { useCallback, useEffect, useState } from 'react';
import type { ConferenceSupabaseClient } from '../../../components/VideoConference/conferenceClient';
import { loadConferenceMessages } from '../services/conferenceRealtime';
import type { ConferenceMessageRow, ConferenceRole } from '../types/conference.types';

interface Params {
  client: ConferenceSupabaseClient;
  roomId: string;
  currentUserId: string;
  currentUserName: string;
  role: ConferenceRole;
}

export function useConferenceChat({ client, roomId, currentUserId, currentUserName, role }: Params) {
  const [messages, setMessages] = useState<ConferenceMessageRow[]>([]);
  const [message, setMessage] = useState('');

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
    if (!body || body.length > 4000) return;
    setMessage('');
    const { error } = await client.from('conference_messages').insert({
      room_id: roomId,
      user_id: currentUserId,
      display_name: currentUserName.slice(0, 60),
      body,
      role: role === 'admin' || role === 'moderator' ? role : 'user',
    });
    if (error) {
      console.error('[VideoConference] chat send failed', error);
      setMessage(body);
    }
  }, [client, currentUserId, currentUserName, message, role, roomId]);

  return { messages, message, setMessage, refreshMessages, sendMessage };
}
