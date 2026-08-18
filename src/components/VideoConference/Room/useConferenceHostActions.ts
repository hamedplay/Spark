// @ts-nocheck
import { stopAllDiagnostics } from '../../../lib/webrtcDiagnostics';
import toast from 'react-hot-toast';
import { ROLE_LABELS, type RoleType } from './roleConstants';

export function useConferenceHostActions(scope: Record<string, any>) {
  const {
    channelRef, currentUserId, currentUserName, onLeave, peersRef, room,
    screenStreamRef, sendSignal, sendSignalRef, setHandRaiseQueue, setHostId, setPeers,
    setRoleDropdown, setShowLeaveConfirm, supabase
  } = scope;

  // ── Host management ────────────────────────────────────────────────────────
  const muteAll = async () => {
    sendSignal(null, 'host_mute_all', { fromHost: currentUserName });
    for (const p of peersRef.current.values()) {
      await supabase.from('room_mod_actions').insert({
        room_id: room.id, by_admin_id: currentUserId,
        target_user_id: p.userId, action_type: 'mute',
      });
    }
    toast.success('درخواست قطع میکروفون برای همه ارسال شد');
  };

  const kickParticipant = async (peerId: string, targetUserId: string, displayName: string) => {
    sendSignal(peerId, 'kick', { fromHost: currentUserName });
    const { error } = await supabase.from('room_mod_actions').insert({
      room_id: room.id, by_admin_id: currentUserId,
      target_user_id: targetUserId, action_type: 'kick',
    });
    if (error) console.error('kick mod_action error:', error);
    await supabase.from('conference_participants')
      .update({ status: 'left', left_at: new Date().toISOString() })
      .eq('room_id', room.id).eq('user_id', targetUserId);
    setTimeout(() => {
      const cur = peersRef.current.get(peerId);
      if (cur) { cur.pc.close(); peersRef.current.delete(peerId); setPeers(new Map(peersRef.current)); }
    }, 500);
    toast.success(`${displayName} از جلسه خارج شد`);
  };

  // durationMinutes = null → مسدودی دائمی
  const banParticipant = async (
    targetPeerId: string, targetUserId: string, displayName: string,
    durationMinutes: number | null,
    reason?: string,
  ) => {
    const expiresAt = durationMinutes != null
      ? new Date(Date.now() + durationMinutes * 60_000).toISOString()
      : null;

    await supabase.from('banned_users').upsert([{
      room_id: room.id, user_id: targetUserId,
      display_name: displayName, banned_by: currentUserId,
      expires_at: expiresAt,
      reason: reason?.trim() || null,
    }], { onConflict: 'room_id,user_id' });

    await kickParticipant(targetPeerId, targetUserId, displayName);

    const label = durationMinutes == null
      ? 'دائمی'
      : durationMinutes < 60 ? `${durationMinutes} دقیقه` : `${durationMinutes / 60} ساعت`;
    toast.success(`${displayName} مسدود شد (${label})`);
  };

  const changeRole = async (_targetPeerId: string, targetUserId: string, displayName: string, newRole: RoleType) => {
    const { error } = await supabase.from('conference_participants')
      .update({ role: newRole })
      .eq('room_id', room.id)
      .eq('user_id', targetUserId);
    if (error) { toast.error('خطا در تغییر نقش'); return; }
    sendSignal(null, 'role_change', { targetUserId, newRole });
    setRoleDropdown(null);
    toast.success(`نقش ${displayName} به "${ROLE_LABELS[newRole]}" تغییر یافت`);
  };
  const lowerHand = (peerId: string) => {
    sendSignal(peerId, 'lower_hand', { fromHost: currentUserName });
    setHandRaiseQueue(q => q.filter(e => e.peerId !== peerId));
  };

  // Transfer host to another participant
  const transferHost = async (targetPeerId: string, targetUserId: string, targetName: string) => {
    sendSignal(null, 'host_transfer', { newHostUserId: targetUserId, newHostName: targetName });
    const { error } = await supabase.from('conference_rooms')
      .update({ host_id: targetUserId })
      .eq('id', room.id);
    if (error) { console.error('transferHost error:', error); toast.error('خطا در انتقال میزبانی'); return; }
    setHostId(targetUserId);
    // Remove from hand queue if they had hand raised
    setHandRaiseQueue(q => q.filter(e => e.peerId !== targetPeerId));
    toast.success(`میزبانی به ${targetName} منتقل شد`);
  };

  const doLeave = async (endRoom: boolean) => {
    setShowLeaveConfirm(false);
    if (endRoom) {
      sendSignalRef.current(null, 'end', { displayName: currentUserName });
      const { error } = await supabase.from('conference_rooms').update({ status: 'ended', ended_at: new Date().toISOString() }).eq('id', room.id);
      if (error) console.error('doLeave end room error:', error);
    } else {
      sendSignalRef.current(null, 'leave', { displayName: currentUserName });
    }
    for (const p of peersRef.current.values()) p.pc.close();
    peersRef.current.clear();
    stopAllDiagnostics();
    screenStreamRef.current?.getTracks().forEach(t => t.stop());
    screenStreamRef.current = null;
    if (channelRef.current) { supabase.removeChannel(channelRef.current); channelRef.current = null; }
    const { error: leaveErr } = await supabase.from('conference_participants').update({ status: 'left', left_at: new Date().toISOString() }).eq('room_id', room.id).eq('user_id', currentUserId);
    if (leaveErr) console.error('doLeave participant update error:', leaveErr);
    onLeave();
  };

  return {
    banParticipant, changeRole, doLeave, kickParticipant, lowerHand, muteAll,
    transferHost
  };
}
