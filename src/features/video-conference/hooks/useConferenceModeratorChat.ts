import { useCallback, useEffect, useState } from 'react';
import type { ConferenceSupabaseClient } from '../../../components/VideoConference/conferenceClient';
import {
  ConferenceModeratorChatActionError,
  loadConferenceModeratorMessages,
  runConferenceModeratorChatAction,
} from '../services/conferenceModeratorChat';
import type {
  ConferenceAuthorization,
  ConferenceModeratorMessageRow,
} from '../types/conference.types';
import { hasConferencePermission } from '../utils/conferencePermissions';

interface Params {
  client: ConferenceSupabaseClient;
  roomId: string;
  currentUserId: string;
  authorization: ConferenceAuthorization;
}

function moderatorChatErrorLabel(error: unknown): string {
  if (error instanceof ConferenceModeratorChatActionError) {
    if (error.code === 'FORBIDDEN') return 'دسترسی به گفتگوی مدیران برای شما مجاز نیست.';
    if (error.code === 'ROOM_ENDED') return 'جلسه پایان یافته است.';
    if (error.code === 'NOT_MESSAGE_SENDER') return 'فقط فرستنده می‌تواند این پیام را تغییر دهد.';
    if (error.code === 'MESSAGE_DELETED') return 'این پیام قبلاً حذف شده است.';
  }
  return 'عملیات گفتگوی مدیران انجام نشد. دوباره تلاش کنید.';
}

export function useConferenceModeratorChat({
  client,
  roomId,
  currentUserId,
  authorization,
}: Params) {
  const [messages, setMessages] = useState<ConferenceModeratorMessageRow[]>([]);
  const [message, setMessage] = useState('');
  const [replyTo, setReplyTo] = useState<ConferenceModeratorMessageRow | null>(null);
  const [editing, setEditing] = useState<ConferenceModeratorMessageRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const canUse = hasConferencePermission(authorization, 'ACCESS_MODERATOR_CHAT');

  const refreshMessages = useCallback(async () => {
    if (!canUse) {
      setMessages([]);
      return;
    }

    try {
      setMessages(await loadConferenceModeratorMessages(client, roomId));
    } catch (error) {
      console.error('[VideoConference] moderator chat load failed', error);
    }
  }, [canUse, client, roomId]);

  useEffect(() => {
    if (!canUse) {
      setMessages([]);
      return undefined;
    }

    void refreshMessages();

    const channel = client
      .channel(`conference-moderator-chat-${roomId}-${currentUserId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'conference_moderator_messages',
        filter: `room_id=eq.${roomId}`,
      }, () => void refreshMessages())
      .subscribe();

    return () => { void client.removeChannel(channel); };
  }, [canUse, client, currentUserId, refreshMessages, roomId]);

  const resetComposer = useCallback(() => {
    setMessage('');
    setReplyTo(null);
    setEditing(null);
    setErrorMessage('');
  }, []);

  const sendMessage = useCallback(async () => {
    const body = message.trim();
    if (!canUse || busy || !body) return;

    setBusy(true);
    setErrorMessage('');
    try {
      if (editing) {
        await runConferenceModeratorChatAction(client, {
          roomId,
          action: 'edit',
          messageId: editing.id,
          body,
        });
      } else {
        await runConferenceModeratorChatAction(client, {
          roomId,
          action: 'send',
          body,
          replyToId: replyTo?.id,
        });
      }
      resetComposer();
      await refreshMessages();
    } catch (error) {
      console.error('[VideoConference] moderator chat mutation failed', error);
      setErrorMessage(moderatorChatErrorLabel(error));
    } finally {
      setBusy(false);
    }
  }, [
    busy,
    canUse,
    client,
    editing,
    message,
    refreshMessages,
    replyTo?.id,
    resetComposer,
    roomId,
  ]);

  const beginReply = useCallback((item: ConferenceModeratorMessageRow) => {
    if (item.is_deleted) return;
    setEditing(null);
    setReplyTo(item);
    setErrorMessage('');
  }, []);

  const beginEdit = useCallback((item: ConferenceModeratorMessageRow) => {
    if (item.is_deleted || item.sender_id !== currentUserId) return;
    setReplyTo(null);
    setEditing(item);
    setMessage(item.body);
    setErrorMessage('');
  }, [currentUserId]);

  const deleteMessage = useCallback(async (
    item: ConferenceModeratorMessageRow,
  ) => {
    if (busy || item.is_deleted || item.sender_id !== currentUserId) return;

    setBusy(true);
    setErrorMessage('');
    try {
      await runConferenceModeratorChatAction(client, {
        roomId,
        action: 'delete',
        messageId: item.id,
      });
      if (editing?.id === item.id || replyTo?.id === item.id) resetComposer();
      await refreshMessages();
    } catch (error) {
      console.error('[VideoConference] moderator chat delete failed', error);
      setErrorMessage(moderatorChatErrorLabel(error));
    } finally {
      setBusy(false);
    }
  }, [
    busy,
    client,
    currentUserId,
    editing?.id,
    refreshMessages,
    replyTo?.id,
    resetComposer,
    roomId,
  ]);

  return {
    messages,
    message,
    setMessage,
    replyTo,
    editing,
    busy,
    errorMessage,
    canUse,
    refreshMessages,
    sendMessage,
    beginReply,
    beginEdit,
    deleteMessage,
    resetComposer,
  };
}
