import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ConferenceSupabaseClient } from '../../../components/VideoConference/conferenceClient';
import { loadConferenceMessages } from '../services/conferenceRealtime';
import {
  ConferenceChatActionError,
  runConferenceChatAction,
} from '../services/conferenceChat';
import type {
  ConferenceAuthorization,
  ConferenceMessageRow,
  ParticipantRow,
} from '../types/conference.types';
import { hasConferencePermission } from '../utils/conferencePermissions';

interface Params {
  client: ConferenceSupabaseClient;
  roomId: string;
  currentUserId: string;
  authorization: ConferenceAuthorization;
  phaseAllowsChat: boolean;
  mentionCandidates: ParticipantRow[];
}

function chatErrorLabel(error: unknown): string {
  if (error instanceof ConferenceChatActionError) {
    if (error.code === 'RATE_LIMITED') {
      const seconds = Math.max(1, Math.ceil(error.retryAfterMs / 1000));
      return `ارسال پیام‌ها خیلی سریع است. حدود ${seconds} ثانیه دیگر دوباره تلاش کنید.`;
    }
    if (error.code === 'CHAT_DISABLED') return 'چت در فاز فعلی جلسه غیرفعال است.';
    if (error.code === 'MESSAGE_DELETED') return 'این پیام قبلاً حذف شده است.';
    if (error.code === 'NOT_MESSAGE_OWNER') return 'فقط نویسنده پیام می‌تواند آن را ویرایش کند.';
  }
  return 'عملیات چت انجام نشد. دوباره تلاش کنید.';
}

export function useConferenceChat({
  client,
  roomId,
  currentUserId,
  authorization,
  phaseAllowsChat,
  mentionCandidates,
}: Params) {
  const [messages, setMessages] = useState<ConferenceMessageRow[]>([]);
  const [message, setMessage] = useState('');
  const [replyTo, setReplyTo] = useState<ConferenceMessageRow | null>(null);
  const [editing, setEditing] = useState<ConferenceMessageRow | null>(null);
  const [selectedMentionUserIds, setSelectedMentionUserIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const canSend = (
    phaseAllowsChat
    && hasConferencePermission(authorization, 'SEND_CHAT')
  );
  const canDeleteAny = hasConferencePermission(authorization, 'DELETE_CHAT');

  const refreshMessages = useCallback(async () => {
    try {
      setMessages(await loadConferenceMessages(client, roomId));
    } catch (error) {
      console.error('[VideoConference] chat load failed', error);
    }
  }, [client, roomId]);

  useEffect(() => { void refreshMessages(); }, [refreshMessages]);

  const selectedMentions = useMemo(
    () => mentionCandidates.filter((row) => selectedMentionUserIds.includes(row.user_id)),
    [mentionCandidates, selectedMentionUserIds],
  );

  const resetComposer = useCallback(() => {
    setMessage('');
    setReplyTo(null);
    setEditing(null);
    setSelectedMentionUserIds([]);
    setErrorMessage('');
  }, []);

  const sendMessage = useCallback(async () => {
    const body = message.trim();
    if (!canSend || busy || (!body && !editing)) return;

    setBusy(true);
    setErrorMessage('');
    try {
      if (editing) {
        await runConferenceChatAction(client, {
          roomId,
          action: 'edit',
          messageId: editing.id,
          body,
          mentionedUserIds: selectedMentionUserIds,
        });
      } else {
        await runConferenceChatAction(client, {
          roomId,
          action: 'send',
          body,
          replyToId: replyTo?.id,
          mentionedUserIds: selectedMentionUserIds,
        });
      }
      resetComposer();
      await refreshMessages();
    } catch (error) {
      console.error('[VideoConference] chat mutation failed', error);
      setErrorMessage(chatErrorLabel(error));
    } finally {
      setBusy(false);
    }
  }, [
    busy,
    canSend,
    client,
    editing,
    message,
    refreshMessages,
    replyTo?.id,
    resetComposer,
    roomId,
    selectedMentionUserIds,
  ]);

  const beginReply = useCallback((item: ConferenceMessageRow) => {
    if (item.is_deleted) return;
    setEditing(null);
    setReplyTo(item);
    setSelectedMentionUserIds([]);
    setErrorMessage('');
  }, []);

  const beginEdit = useCallback((item: ConferenceMessageRow) => {
    if (item.is_deleted || item.user_id !== currentUserId) return;
    setReplyTo(null);
    setEditing(item);
    setMessage(item.body);
    setSelectedMentionUserIds(item.mentioned_user_ids);
    setErrorMessage('');
  }, [currentUserId]);

  const deleteMessage = useCallback(async (item: ConferenceMessageRow) => {
    if (
      busy
      || item.is_deleted
      || (item.user_id !== currentUserId && !canDeleteAny)
    ) return;

    setBusy(true);
    setErrorMessage('');
    try {
      await runConferenceChatAction(client, {
        roomId,
        action: 'delete',
        messageId: item.id,
      });
      if (editing?.id === item.id || replyTo?.id === item.id) resetComposer();
      await refreshMessages();
    } catch (error) {
      console.error('[VideoConference] chat delete failed', error);
      setErrorMessage(chatErrorLabel(error));
    } finally {
      setBusy(false);
    }
  }, [
    busy,
    canDeleteAny,
    client,
    currentUserId,
    editing?.id,
    refreshMessages,
    replyTo?.id,
    resetComposer,
    roomId,
  ]);

  const toggleReaction = useCallback(async (
    item: ConferenceMessageRow,
    emoji: string,
  ) => {
    if (!canSend || busy || item.is_deleted) return;
    setBusy(true);
    setErrorMessage('');
    try {
      await runConferenceChatAction(client, {
        roomId,
        action: 'react',
        messageId: item.id,
        emoji,
      });
      await refreshMessages();
    } catch (error) {
      console.error('[VideoConference] chat reaction failed', error);
      setErrorMessage(chatErrorLabel(error));
    } finally {
      setBusy(false);
    }
  }, [busy, canSend, client, refreshMessages, roomId]);

  const toggleMention = useCallback((participant: ParticipantRow) => {
    if (!participant.user_id || participant.user_id === currentUserId) return;
    const selected = selectedMentionUserIds.includes(participant.user_id);
    setSelectedMentionUserIds((current) => selected
      ? current.filter((id) => id !== participant.user_id)
      : [...current, participant.user_id].slice(0, 10));

    const label = participant.display_name.trim();
    if (!selected && label && !message.includes(`@${label}`)) {
      setMessage((current) => {
        const prefix = current && !current.endsWith(' ') ? `${current} ` : current;
        return `${prefix}@${label} `;
      });
    }
  }, [currentUserId, message, selectedMentionUserIds]);

  return {
    messages,
    message,
    setMessage,
    replyTo,
    editing,
    selectedMentions,
    selectedMentionUserIds,
    mentionCandidates: mentionCandidates.filter(
      (row) => row.user_id !== currentUserId && Boolean(row.display_name.trim()),
    ),
    busy,
    errorMessage,
    canSend,
    canDeleteAny,
    refreshMessages,
    sendMessage,
    beginReply,
    beginEdit,
    deleteMessage,
    toggleReaction,
    toggleMention,
    resetComposer,
  };
}
