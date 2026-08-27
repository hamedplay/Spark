import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ConferenceSupabaseClient } from '../../../components/VideoConference/conferenceClient';
import {
  ConferencePrivateChatActionError,
  loadConferencePrivateMessages,
  runConferencePrivateChatAction,
} from '../services/conferencePrivateChat';
import type {
  ConferenceAuthorization,
  ConferencePrivateMessageRow,
  ParticipantRow,
} from '../types/conference.types';
import { hasConferencePermission } from '../utils/conferencePermissions';

interface Params {
  client: ConferenceSupabaseClient;
  roomId: string;
  currentUserId: string;
  authorization: ConferenceAuthorization;
  phaseAllowsChat: boolean;
  participants: ParticipantRow[];
}

function privateChatErrorLabel(error: unknown): string {
  if (error instanceof ConferencePrivateChatActionError) {
    if (error.code === 'CHAT_DISABLED') return 'چت در فاز فعلی جلسه غیرفعال است.';
    if (error.code === 'RECIPIENT_NOT_JOINED') return 'مخاطب دیگر در جلسه حضور ندارد.';
    if (error.code === 'NOT_MESSAGE_SENDER') return 'فقط فرستنده می‌تواند این پیام را تغییر دهد.';
    if (error.code === 'MESSAGE_DELETED') return 'این پیام قبلاً حذف شده است.';
  }
  return 'عملیات پیام خصوصی انجام نشد. دوباره تلاش کنید.';
}

export function useConferencePrivateChat({
  client,
  roomId,
  currentUserId,
  authorization,
  phaseAllowsChat,
  participants,
}: Params) {
  const [messages, setMessages] = useState<ConferencePrivateMessageRow[]>([]);
  const [selectedPeerUserId, setSelectedPeerUserId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [replyTo, setReplyTo] = useState<ConferencePrivateMessageRow | null>(null);
  const [editing, setEditing] = useState<ConferencePrivateMessageRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const readInFlightRef = useRef<string | null>(null);

  const canUse = hasConferencePermission(authorization, 'SEND_PRIVATE_CHAT');
  const canSend = canUse && phaseAllowsChat;
  const peers = useMemo(
    () => participants.filter(
      (row) => row.user_id !== currentUserId && row.status === 'joined',
    ),
    [currentUserId, participants],
  );

  const refreshMessages = useCallback(async () => {
    try {
      setMessages(await loadConferencePrivateMessages(client, roomId));
    } catch (error) {
      console.error('[VideoConference] private chat load failed', error);
    }
  }, [client, roomId]);

  useEffect(() => {
    void refreshMessages();

    const channel = client
      .channel(`conference-private-chat-${roomId}-${currentUserId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'conference_private_messages',
        filter: `room_id=eq.${roomId}`,
      }, () => void refreshMessages())
      .subscribe();

    return () => { void client.removeChannel(channel); };
  }, [client, currentUserId, refreshMessages, roomId]);

  useEffect(() => {
    if (
      selectedPeerUserId
      && peers.some((peer) => peer.user_id === selectedPeerUserId)
    ) return;

    setSelectedPeerUserId(peers[0]?.user_id || null);
  }, [peers, selectedPeerUserId]);

  const conversation = useMemo(() => {
    if (!selectedPeerUserId) return [];
    return messages.filter((row) => (
      (
        row.sender_id === currentUserId
        && row.recipient_id === selectedPeerUserId
      )
      || (
        row.sender_id === selectedPeerUserId
        && row.recipient_id === currentUserId
      )
    ));
  }, [currentUserId, messages, selectedPeerUserId]);

  const unreadCount = useMemo(
    () => messages.filter(
      (row) => (
        row.recipient_id === currentUserId
        && row.sender_id !== currentUserId
        && row.read_at === null
        && !row.is_deleted
      ),
    ).length,
    [currentUserId, messages],
  );

  const unreadByPeer = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const row of messages) {
      if (
        row.recipient_id !== currentUserId
        || row.read_at !== null
        || row.is_deleted
      ) continue;
      counts[row.sender_id] = (counts[row.sender_id] || 0) + 1;
    }
    return counts;
  }, [currentUserId, messages]);

  const resetComposer = useCallback(() => {
    setMessage('');
    setReplyTo(null);
    setEditing(null);
    setErrorMessage('');
  }, []);

  const selectPeer = useCallback((userId: string) => {
    setSelectedPeerUserId(userId);
    resetComposer();
  }, [resetComposer]);

  useEffect(() => {
    const peer = selectedPeerUserId;
    if (!peer || readInFlightRef.current === peer) return;

    const hasUnread = messages.some((row) => (
      row.sender_id === peer
      && row.recipient_id === currentUserId
      && row.read_at === null
      && !row.is_deleted
    ));
    if (!hasUnread) return;

    readInFlightRef.current = peer;
    void runConferencePrivateChatAction(client, {
      roomId,
      action: 'read',
      peerUserId: peer,
    }).then(refreshMessages).catch((error) => {
      console.error('[VideoConference] private chat read receipt failed', error);
    }).finally(() => {
      readInFlightRef.current = null;
    });
  }, [
    client,
    currentUserId,
    messages,
    refreshMessages,
    roomId,
    selectedPeerUserId,
  ]);

  const sendMessage = useCallback(async () => {
    const body = message.trim();
    if (!canSend || busy || !body || !selectedPeerUserId) return;

    setBusy(true);
    setErrorMessage('');
    try {
      if (editing) {
        await runConferencePrivateChatAction(client, {
          roomId,
          action: 'edit',
          messageId: editing.id,
          body,
        });
      } else {
        await runConferencePrivateChatAction(client, {
          roomId,
          action: 'send',
          peerUserId: selectedPeerUserId,
          body,
          replyToId: replyTo?.id,
        });
      }
      resetComposer();
      await refreshMessages();
    } catch (error) {
      console.error('[VideoConference] private chat mutation failed', error);
      setErrorMessage(privateChatErrorLabel(error));
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
    selectedPeerUserId,
  ]);

  const beginReply = useCallback((item: ConferencePrivateMessageRow) => {
    if (item.is_deleted) return;
    setEditing(null);
    setReplyTo(item);
    setErrorMessage('');
  }, []);

  const beginEdit = useCallback((item: ConferencePrivateMessageRow) => {
    if (item.is_deleted || item.sender_id !== currentUserId) return;
    setReplyTo(null);
    setEditing(item);
    setMessage(item.body);
    setErrorMessage('');
  }, [currentUserId]);

  const deleteMessage = useCallback(async (
    item: ConferencePrivateMessageRow,
  ) => {
    if (busy || item.is_deleted || item.sender_id !== currentUserId) return;

    setBusy(true);
    setErrorMessage('');
    try {
      await runConferencePrivateChatAction(client, {
        roomId,
        action: 'delete',
        messageId: item.id,
      });
      if (editing?.id === item.id || replyTo?.id === item.id) resetComposer();
      await refreshMessages();
    } catch (error) {
      console.error('[VideoConference] private chat delete failed', error);
      setErrorMessage(privateChatErrorLabel(error));
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
    conversation,
    peers,
    selectedPeerUserId,
    unreadCount,
    unreadByPeer,
    message,
    setMessage,
    replyTo,
    editing,
    busy,
    errorMessage,
    canUse,
    canSend,
    refreshMessages,
    selectPeer,
    sendMessage,
    beginReply,
    beginEdit,
    deleteMessage,
    resetComposer,
  };
}
