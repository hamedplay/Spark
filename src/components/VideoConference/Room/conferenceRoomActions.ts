import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import toast from 'react-hot-toast';
import { stopAllDiagnostics } from '../../../lib/webrtcDiagnostics';
import type { PeerConnection } from '../types';
import type { RoleType } from './roleConstants';
import { ROLE_LABELS } from './roleConstants';
import type { useConferenceClient } from '../conferenceClient';

type ConferenceClient = ReturnType<typeof useConferenceClient>;

type SignalSender = (peerId: string | null, type: string, data: object) => void;

interface ConferenceRoomActionsContext {
  supabase: ConferenceClient;
  roomId: string;
  roomCode: string;
  currentUserId: string;
  currentUserName: string;
  peersRef: MutableRefObject<Map<string, PeerConnection>>;
  screenStreamRef: MutableRefObject<MediaStream | null>;
  channelRef: MutableRefObject<ReturnType<ConferenceClient['channel']> | null>;
  sendSignal: SignalSender;
  sendSignalRef: MutableRefObject<SignalSender>;
  setPeers: Dispatch<SetStateAction<Map<string, PeerConnection>>>;
  setHostId: Dispatch<SetStateAction<string>>;
  setHandRaiseQueue: Dispatch<SetStateAction<Array<{ peerId: string; name: string; time: number }>>>;
  setRoleDropdown: Dispatch<SetStateAction<string | null>>;
  setShowLeaveConfirm: Dispatch<SetStateAction<boolean>>;
  onLeave: () => void;
}

export function createConferenceRoomActions({
  supabase,
  roomId,
  roomCode,
  currentUserId,
  currentUserName,
  peersRef,
  screenStreamRef,
  channelRef,
  sendSignal,
  sendSignalRef,
  setPeers,
  setHostId,
  setHandRaiseQueue,
  setRoleDropdown,
  setShowLeaveConfirm,
  onLeave,
}: ConferenceRoomActionsContext) {
  const muteAll = async () => {
    sendSignal(null, 'host_mute_all', { fromHost: currentUserName });
    for (const peer of peersRef.current.values()) {
      await supabase.from('room_mod_actions').insert({
        room_id: roomId,
        by_admin_id: currentUserId,
        target_user_id: peer.userId,
        action_type: 'mute',
      });
    }
    toast.success('درخواست قطع میکروفون برای همه ارسال شد');
  };

  const kickParticipant = async (peerId: string, targetUserId: string, displayName: string) => {
    sendSignal(peerId, 'kick', { fromHost: currentUserName });
    const { error } = await supabase.from('room_mod_actions').insert({
      room_id: roomId,
      by_admin_id: currentUserId,
      target_user_id: targetUserId,
      action_type: 'kick',
    });
    if (error) console.error('kick mod_action error:', error);
    await supabase.from('conference_participants')
      .update({ status: 'left', left_at: new Date().toISOString() })
      .eq('room_id', roomId)
      .eq('user_id', targetUserId);
    setTimeout(() => {
      const current = peersRef.current.get(peerId);
      if (current) {
        current.pc.close();
        peersRef.current.delete(peerId);
        setPeers(new Map(peersRef.current));
      }
    }, 500);
    toast.success(`${displayName} از جلسه خارج شد`);
  };

  const banParticipant = async (
    targetPeerId: string,
    targetUserId: string,
    displayName: string,
    durationMinutes: number | null,
    reason?: string,
  ) => {
    const expiresAt = durationMinutes != null
      ? new Date(Date.now() + durationMinutes * 60_000).toISOString()
      : null;

    await supabase.from('banned_users').upsert([{
      room_id: roomId,
      user_id: targetUserId,
      display_name: displayName,
      banned_by: currentUserId,
      expires_at: expiresAt,
      reason: reason?.trim() || null,
    }], { onConflict: 'room_id,user_id' });

    await kickParticipant(targetPeerId, targetUserId, displayName);

    const label = durationMinutes == null
      ? 'دائمی'
      : durationMinutes < 60 ? `${durationMinutes} دقیقه` : `${durationMinutes / 60} ساعت`;
    toast.success(`${displayName} مسدود شد (${label})`);
  };

  const changeRole = async (
    _targetPeerId: string,
    targetUserId: string,
    displayName: string,
    newRole: RoleType,
  ) => {
    const { error } = await supabase.from('conference_participants')
      .update({ role: newRole })
      .eq('room_id', roomId)
      .eq('user_id', targetUserId);
    if (error) {
      toast.error('خطا در تغییر نقش');
      return;
    }
    sendSignal(null, 'role_change', { targetUserId, newRole });
    setRoleDropdown(null);
    toast.success(`نقش ${displayName} به "${ROLE_LABELS[newRole]}" تغییر یافت`);
  };

  const lowerHand = (peerId: string) => {
    sendSignal(peerId, 'lower_hand', { fromHost: currentUserName });
    setHandRaiseQueue(queue => queue.filter(entry => entry.peerId !== peerId));
  };

  const transferHost = async (targetPeerId: string, targetUserId: string, targetName: string) => {
    sendSignal(null, 'host_transfer', { newHostUserId: targetUserId, newHostName: targetName });
    const { error } = await supabase.from('conference_rooms')
      .update({ host_id: targetUserId })
      .eq('id', roomId);
    if (error) {
      console.error('transferHost error:', error);
      toast.error('خطا در انتقال میزبانی');
      return;
    }
    setHostId(targetUserId);
    setHandRaiseQueue(queue => queue.filter(entry => entry.peerId !== targetPeerId));
    toast.success(`میزبانی به ${targetName} منتقل شد`);
  };

  const doLeave = async (endRoom: boolean) => {
    setShowLeaveConfirm(false);
    if (endRoom) {
      sendSignalRef.current(null, 'end', { displayName: currentUserName });
      const { error } = await supabase.from('conference_rooms')
        .update({ status: 'ended', ended_at: new Date().toISOString() })
        .eq('id', roomId);
      if (error) console.error('doLeave end room error:', error);
    } else {
      sendSignalRef.current(null, 'leave', { displayName: currentUserName });
    }

    for (const peer of peersRef.current.values()) peer.pc.close();
    peersRef.current.clear();
    stopAllDiagnostics();
    screenStreamRef.current?.getTracks().forEach(track => track.stop());
    screenStreamRef.current = null;
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
    const { error: leaveError } = await supabase.from('conference_participants')
      .update({ status: 'left', left_at: new Date().toISOString() })
      .eq('room_id', roomId)
      .eq('user_id', currentUserId);
    if (leaveError) console.error('doLeave participant update error:', leaveError);
    onLeave();
  };

  const copyCode = () => navigator.clipboard.writeText(roomCode);

  return {
    muteAll,
    kickParticipant,
    banParticipant,
    changeRole,
    lowerHand,
    transferHost,
    doLeave,
    copyCode,
  };
}
