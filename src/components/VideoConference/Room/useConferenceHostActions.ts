import type { MutableRefObject } from 'react';
import { stopAllDiagnostics } from '../../../lib/webrtcDiagnostics';
import toast from 'react-hot-toast';
import { ROLE_LABELS, type RoleType } from './roleConstants';
import type { ConferenceRoom, PeerConnection } from '../types';

type SupabaseLike = any;

interface HostActionsScope {
  channelRef: MutableRefObject<any>;
  currentUserId: string;
  currentUserName: string;
  onLeave: () => void;
  peersRef: MutableRefObject<Map<string, PeerConnection>>;
  room: ConferenceRoom;
  screenStreamRef: MutableRefObject<MediaStream | null>;
  sendSignal: (to: string | null, type: string, data: object) => void;
  sendSignalRef: MutableRefObject<(to: string | null, type: string, data: object) => void>;
  setHandRaiseQueue: React.Dispatch<React.SetStateAction<Array<{ peerId: string; name: string; time: number }>>>;
  setHostId: React.Dispatch<React.SetStateAction<string>>;
  setPeers: React.Dispatch<React.SetStateAction<Map<string, PeerConnection>>>;
  setRoleDropdown: React.Dispatch<React.SetStateAction<string | null>>;
  setShowLeaveConfirm: React.Dispatch<React.SetStateAction<boolean>>;
  supabase: SupabaseLike;
}

function rpcErrorMessage(result: any, fallback: string) {
  return result?.reason ? `${fallback}: ${result.reason}` : fallback;
}

export function useConferenceHostActions(scope: HostActionsScope) {
  const {
    channelRef, currentUserId, currentUserName, onLeave, peersRef, room,
    screenStreamRef, sendSignalRef, setHandRaiseQueue, setHostId, setPeers,
    setRoleDropdown, setShowLeaveConfirm, supabase,
  } = scope;

  const muteAll = async () => {
    const { data, error } = await supabase.rpc('mute_all_conference_participants', { p_room_id: room.id });
    if (error || !data?.ok) {
      toast.error(rpcErrorMessage(data, 'خطا در قطع میکروفون‌ها'));
      return;
    }
    toast.success('درخواست قطع میکروفون برای همه ثبت شد');
  };

  const kickParticipant = async (peerId: string, targetUserId: string, displayName: string) => {
    const { data, error } = await supabase.rpc('moderate_conference_participant', {
      p_room_id: room.id,
      p_target_user_id: targetUserId,
      p_action: 'kick',
    });
    if (error || !data?.ok) {
      toast.error(rpcErrorMessage(data, 'خطا در خارج کردن کاربر'));
      return;
    }
    const cur = peersRef.current.get(peerId);
    if (cur) {
      cur.pc.close();
      peersRef.current.delete(peerId);
      setPeers(new Map(peersRef.current));
    }
    toast.success(`${displayName} از جلسه خارج شد`);
  };

  const banParticipant = async (
    targetPeerId: string,
    targetUserId: string,
    displayName: string,
    durationMinutes: number | null,
    reason?: string,
  ) => {
    const { data, error } = await supabase.rpc('ban_conference_participant', {
      p_room_id: room.id,
      p_target_user_id: targetUserId,
      p_display_name: displayName,
      p_duration_minutes: durationMinutes,
      p_reason: reason?.trim() || null,
    });
    if (error || !data?.ok) {
      toast.error(rpcErrorMessage(data, 'خطا در مسدود کردن کاربر'));
      return;
    }
    const cur = peersRef.current.get(targetPeerId);
    if (cur) {
      cur.pc.close();
      peersRef.current.delete(targetPeerId);
      setPeers(new Map(peersRef.current));
    }
    const label = durationMinutes == null
      ? 'دائمی'
      : durationMinutes < 60 ? `${durationMinutes} دقیقه` : `${durationMinutes / 60} ساعت`;
    toast.success(`${displayName} مسدود شد (${label})`);
  };

  const changeRole = async (_targetPeerId: string, targetUserId: string, displayName: string, newRole: RoleType) => {
    if (!['admin', 'moderator', 'member'].includes(newRole)) {
      toast.error('این نقش از این مسیر قابل تخصیص نیست');
      return;
    }
    const { data, error } = await supabase.rpc('set_conference_participant_role', {
      p_room_id: room.id,
      p_target_user_id: targetUserId,
      p_role: newRole,
    });
    if (error || !data?.ok) {
      toast.error(rpcErrorMessage(data, 'خطا در تغییر نقش'));
      return;
    }
    setRoleDropdown(null);
    toast.success(`نقش ${displayName} به «${ROLE_LABELS[newRole]}» تغییر یافت`);
  };

  const lowerHand = async (peerId: string) => {
    const target = peersRef.current.get(peerId);
    if (!target) return;
    const { data, error } = await supabase.rpc('moderate_conference_participant', {
      p_room_id: room.id,
      p_target_user_id: target.userId,
      p_action: 'lower_hand',
    });
    if (error || !data?.ok) {
      toast.error(rpcErrorMessage(data, 'خطا در پایین آوردن دست'));
      return;
    }
    setHandRaiseQueue(q => q.filter(e => e.peerId !== peerId));
  };

  const transferHost = async (targetPeerId: string, targetUserId: string, targetName: string) => {
    const { data, error } = await supabase.rpc('transfer_conference_host', {
      p_room_id: room.id,
      p_target_user_id: targetUserId,
    });
    if (error || !data?.ok) {
      toast.error(rpcErrorMessage(data, 'خطا در انتقال میزبانی'));
      return;
    }
    setHostId(targetUserId);
    setHandRaiseQueue(q => q.filter(e => e.peerId !== targetPeerId));
    toast.success(`میزبانی به ${targetName} منتقل شد`);
  };

  const doLeave = async (endRoom: boolean) => {
    setShowLeaveConfirm(false);
    if (endRoom) {
      const { data, error } = await supabase.rpc('end_conference_room', {
        p_room_id: room.id,
        p_reason: 'ended_by_host',
      });
      if (error || !data?.ok) {
        toast.error(rpcErrorMessage(data, 'خطا در پایان دادن جلسه'));
        return;
      }
    } else {
      // A leave broadcast is only transient peer cleanup. DB remains authoritative.
      sendSignalRef.current(null, 'leave', { displayName: currentUserName });
      await supabase.rpc('leave_conference_room', { p_room_id: room.id });
    }

    for (const p of peersRef.current.values()) p.pc.close();
    peersRef.current.clear();
    stopAllDiagnostics();
    screenStreamRef.current?.getTracks().forEach(t => t.stop());
    screenStreamRef.current = null;
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
    onLeave();
  };

  return {
    banParticipant,
    changeRole,
    doLeave,
    kickParticipant,
    lowerHand,
    muteAll,
    transferHost,
  };
}
