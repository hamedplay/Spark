import { useState, useEffect, useRef, useCallback } from 'react';
import { startDiagnostics, stopDiagnostics, attemptICERestart } from '../../../lib/webrtcDiagnostics';
import toast from 'react-hot-toast';
import type { ConferenceParticipant, ConferenceMessage, PeerConnection, Reaction } from '../types';
import { type RoleType } from './roleConstants';
import { MAX_PARTICIPANTS, setPreferredCodecs } from './webrtcHelpers';

const TRANSIENT_SIGNAL_TYPES = new Set([
  'offer', 'answer', 'ice', 'join', 'leave', 'state', 'chat', 'reaction',
]);

export function useConferenceWebRTC(scope: any) {
  const {
    broadcastStateRef, channelRef, currentUserId, currentUserName, dispatch, iceCandidateQueue,
    localStreamRef, mediaRef, myPeerId, myPeerIdRef, onLeave, peersRef, screenStreamRef,
    room, rtcConfigReadyRef, rtcConfigRef, setChatEnabled, setDbPinnedUserId, setHandRaiseQueue, setHostId, setPresenterUserId,
    setMessages, setMyLimitSecs, setMyQuality, setMyRole, setPeerDiagnostics, setPeers,
    setReactions, setSpeakingLimitEnabled, setUnreadCount, sidePanelRef, supabase,
  } = scope;

  const authorizedPeersRef = useRef<Set<string>>(new Set());
  const leavingFromDbRef = useRef(false);

  const sendSignal = useCallback((toPeerId: string | null, type: string, data: object) => {
    if (!TRANSIENT_SIGNAL_TYPES.has(type)) {
      console.warn(`[WebRTC] blocked non-transient broadcast type=${type}`);
      return;
    }
    channelRef.current?.send({
      type: 'broadcast',
      event: 'signal',
      payload: {
        from: myPeerIdRef.current,
        from_user_id: currentUserId,
        from_name: currentUserName,
        to: toPeerId,
        type,
        data,
      },
    });
  }, [currentUserId, currentUserName, channelRef, myPeerIdRef]);

  const validateSignalSender = useCallback(async (peerId: string, userId: string) => {
    if (!peerId || !userId) return false;
    const key = `${userId}:${peerId}`;
    if (authorizedPeersRef.current.has(key)) return true;
    const { data, error } = await supabase
      .from('conference_participants')
      .select('user_id, peer_id')
      .eq('room_id', room.id)
      .eq('user_id', userId)
      .eq('peer_id', peerId)
      .eq('status', 'joined')
      .maybeSingle();
    if (error || !data) return false;
    authorizedPeersRef.current.add(key);
    return true;
  }, [room.id, supabase]);

  const buildPC = useCallback(async (remotePeerId: string, remoteUserId: string, remoteDisplayName: string): Promise<RTCPeerConnection> => {
    await rtcConfigReadyRef.current;
    const localStream: MediaStream | null = localStreamRef.current;
    if (!localStream) throw new Error('LOCAL_MEDIA_STREAM_UNAVAILABLE');

    console.log(
      `[WRTCDiag] buildPC peer=${remotePeerId} iceServers=${rtcConfigRef.current.iceServers?.length ?? 0}` +
      ` policy=${rtcConfigRef.current.iceTransportPolicy ?? 'all'}`,
    );
    const pc = new RTCPeerConnection(rtcConfigRef.current);
    localStream.getTracks().forEach((track: MediaStreamTrack) => pc.addTrack(track, localStream));
    const activeScreen: MediaStream | null = screenStreamRef.current;
    activeScreen?.getTracks().forEach((track: MediaStreamTrack) => pc.addTrack(track, activeScreen));
    setPreferredCodecs(pc);

    const conn: PeerConnection = {
      peerId: remotePeerId,
      userId: remoteUserId,
      displayName: remoteDisplayName,
      pc,
      stream: null,
      screenStream: null,
      isScreenSharing: false,
      isMuted: false,
      isVideoOff: false,
      isHandRaised: false,
      connectionState: 'new',
      networkQuality: 'good',
      speakingSeconds: 0,
      audioLevel: 0,
    };
    peersRef.current.set(remotePeerId, conn);
    setPeers(new Map(peersRef.current));

    pc.ontrack = (event) => {
      const incoming = event.streams[0];
      if (!incoming) return;
      const current = peersRef.current.get(remotePeerId);
      if (!current) return;
      const isSecondary = Boolean(current.stream && current.stream.id !== incoming.id);
      const next = isSecondary ? { ...current, screenStream: incoming, isScreenSharing: true } : { ...current, stream: incoming };
      peersRef.current.set(remotePeerId, next);
      setPeers(new Map(peersRef.current));
      if (isSecondary) {
        const clear = () => {
          const latest = peersRef.current.get(remotePeerId);
          if (!latest || latest.screenStream?.id !== incoming.id) return;
          peersRef.current.set(remotePeerId, { ...latest, screenStream: null, isScreenSharing: false });
          setPeers(new Map(peersRef.current));
        };
        incoming.getTracks().forEach(track => track.addEventListener('ended', clear, { once: true }));
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) sendSignal(remotePeerId, 'ice', { candidate: event.candidate.toJSON() });
    };

    pc.onconnectionstatechange = () => {
      const current = peersRef.current.get(remotePeerId);
      if (current) {
        peersRef.current.set(remotePeerId, { ...current, connectionState: pc.connectionState });
        setPeers(new Map(peersRef.current));
      }
      if (pc.connectionState === 'connected') toast.success(`${remoteDisplayName} وارد شد`);
      if (pc.connectionState === 'disconnected') {
        setTimeout(async () => {
          if (pc.connectionState !== 'disconnected' && pc.connectionState !== 'failed') return;
          const restarted = await attemptICERestart(pc, offer => {
            sendSignal(remotePeerId, 'offer', { sdp: offer, iceRestart: true });
          });
          if (restarted) return;
          setTimeout(() => {
            if (pc.connectionState !== 'disconnected' && pc.connectionState !== 'failed') return;
            stopDiagnostics(remotePeerId);
            pc.close();
            peersRef.current.delete(remotePeerId);
            setPeers(new Map(peersRef.current));
          }, 15_000);
        }, 5_000);
      } else if (pc.connectionState === 'failed') {
        stopDiagnostics(remotePeerId);
        setTimeout(() => {
          if (pc.connectionState !== 'failed') return;
          pc.close();
          peersRef.current.delete(remotePeerId);
          setPeers(new Map(peersRef.current));
        }, 2_000);
      }
    };

    startDiagnostics(pc, remotePeerId, (diagnostics) => {
      setPeerDiagnostics((prev: Map<string, unknown>) => new Map(prev).set(remotePeerId, diagnostics));
    });

    return pc;
  }, [rtcConfigReadyRef, rtcConfigRef, localStreamRef, peersRef, setPeers, sendSignal, setPeerDiagnostics]);

  const getPC = useCallback(async (remotePeerId: string, remoteUserId: string, remoteDisplayName: string) => {
    const current = peersRef.current.get(remotePeerId);
    if (current && current.pc.connectionState !== 'failed' && current.pc.connectionState !== 'closed') return current.pc;
    return buildPC(remotePeerId, remoteUserId, remoteDisplayName);
  }, [buildPC, peersRef]);

  const flushICE = useCallback(async (remotePeerId: string) => {
    const queue: RTCIceCandidateInit[] = iceCandidateQueue.current.get(remotePeerId) || [];
    if (!queue.length) return;
    const pc: RTCPeerConnection | undefined = peersRef.current.get(remotePeerId)?.pc;
    if (!pc?.remoteDescription) return;
    for (const candidate of queue) {
      try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); }
      catch (error) { console.warn('[WRTCDiag] queued ICE candidate rejected', error); }
    }
    iceCandidateQueue.current.delete(remotePeerId);
  }, [iceCandidateQueue, peersRef]);

  const makeOffer = useCallback(async (remotePeerId: string, remoteUserId: string, remoteDisplayName: string) => {
    const pc = await getPC(remotePeerId, remoteUserId, remoteDisplayName);
    if (pc.signalingState !== 'stable') return;
    try {
      const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
      await pc.setLocalDescription(offer);
      sendSignal(remotePeerId, 'offer', { sdp: pc.localDescription });
    } catch (error) {
      console.error('makeOffer failed', error);
    }
  }, [getPC, sendSignal]);

  const makeOfferRef = useRef(makeOffer);
  const sendSignalRef = useRef(sendSignal);
  const getPCRef = useRef(getPC);
  const flushICERef = useRef(flushICE);
  const stopScreenShareRef = useRef<() => void>(() => {});
  const showTileReactionRef = useRef<(userId: string, emoji: string) => void>(() => {});
  makeOfferRef.current = makeOffer;
  sendSignalRef.current = sendSignal;
  getPCRef.current = getPC;
  flushICERef.current = flushICE;

  useEffect(() => {
    const channel = supabase.channel(`conference:${room.id}:signal`, {
      config: { private: true, broadcast: { self: false } },
    });
    channelRef.current = channel;

    channel.on('broadcast', { event: 'signal' }, ({ payload }: any) => {
      if (!payload || (payload.to !== null && payload.to !== myPeerIdRef.current)) return;
      if (payload.from === myPeerIdRef.current) return;
      const { from, from_user_id: fromUserId, from_name: fromName, type, data } = payload;

      void (async () => {
        if (!TRANSIENT_SIGNAL_TYPES.has(type)) return;
        if (!await validateSignalSender(from, fromUserId)) {
          console.warn(`[WebRTC] rejected unbound signal sender user=${fromUserId} peer=${from}`);
          return;
        }

        if (type === 'join') {
          if (peersRef.current.size >= MAX_PARTICIPANTS - 1) return;
          if (myPeerIdRef.current < from) await makeOfferRef.current(from, fromUserId, fromName);
          else await getPCRef.current(from, fromUserId, fromName);
          return;
        }

        if (type === 'offer') {
          const pc = await getPCRef.current(from, fromUserId, fromName);
          try {
            if (pc.signalingState === 'have-local-offer') {
              if (myPeerIdRef.current < from) await pc.setLocalDescription({ type: 'rollback' } as RTCSessionDescriptionInit);
              else return;
            }
            if (pc.signalingState !== 'stable') return;
            await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
            await flushICERef.current(from);
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            sendSignalRef.current(from, 'answer', { sdp: pc.localDescription });
          } catch (error) { console.error('offer error', error); }
          return;
        }

        if (type === 'answer') {
          const current = peersRef.current.get(from);
          if (current?.pc.signalingState !== 'have-local-offer') return;
          try {
            await current.pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
            await flushICERef.current(from);
          } catch (error) { console.error('answer error', error); }
          return;
        }

        if (type === 'ice') {
          const current = peersRef.current.get(from);
          if (current?.pc?.remoteDescription) {
            try { await current.pc.addIceCandidate(new RTCIceCandidate(data.candidate)); }
            catch (error) { console.warn('[WRTCDiag] ICE candidate rejected', error); }
          } else {
            const queue: RTCIceCandidateInit[] = iceCandidateQueue.current.get(from) || [];
            queue.push(data.candidate);
            iceCandidateQueue.current.set(from, queue);
          }
          return;
        }

        if (type === 'leave') {
          const current = peersRef.current.get(from);
          if (current) {
            stopDiagnostics(from);
            current.pc.close();
            peersRef.current.delete(from);
            setPeers(new Map(peersRef.current));
            toast(`${fromName} جلسه را ترک کرد`);
          }
          return;
        }

        if (type === 'state') {
          const current = peersRef.current.get(from);
          if (!current) return;
          const wasHandRaised = current.isHandRaised;
          const next = {
            ...current,
            isMuted: Boolean(data.isMuted),
            isVideoOff: Boolean(data.isVideoOff),
            isHandRaised: Boolean(data.isHandRaised),
            isScreenSharing: Boolean(data.isScreenSharing),
          };
          peersRef.current.set(from, next);
          setPeers(new Map(peersRef.current));
          if (next.isHandRaised && !wasHandRaised) {
            setHandRaiseQueue((queue: any[]) => [...queue.filter(e => e.peerId !== from), { peerId: from, name: fromName, time: Date.now() }]);
          } else if (!next.isHandRaised && wasHandRaised) {
            setHandRaiseQueue((queue: any[]) => queue.filter(e => e.peerId !== from));
          }
          return;
        }

        if (type === 'chat') {
          const message: ConferenceMessage = {
            ...data,
            user_id: fromUserId,
            display_name: fromName,
            room_id: room.id,
          };
          setMessages((prev: ConferenceMessage[]) => prev.some(m => m.id === message.id) ? prev : [...prev, message]);
          if (sidePanelRef.current !== 'chat') setUnreadCount((count: number) => count + 1);
          return;
        }

        if (type === 'reaction') {
          const reaction: Reaction = {
            ...data,
            userId: fromUserId,
            displayName: fromName,
            x: Math.random() * 80 + 10,
            y: Math.random() * 60 + 20,
            createdAt: Date.now(),
            expiresAt: Date.now() + 3000,
          };
          setReactions((prev: Reaction[]) => [...prev, reaction]);
          setTimeout(() => setReactions((prev: Reaction[]) => prev.filter(r => r.id !== reaction.id)), 3000);
          showTileReactionRef.current(fromUserId, reaction.emoji);
        }
      })();
    }).subscribe(async (status: string) => {
      if (status !== 'SUBSCRIBED') return;
      sendSignalRef.current(null, 'join', { userId: currentUserId, displayName: currentUserName, peerId: myPeerIdRef.current });
      await new Promise(resolve => setTimeout(resolve, 300));
      const { data: existing } = await supabase
        .from('conference_participants')
        .select('user_id, display_name, peer_id')
        .eq('room_id', room.id)
        .eq('status', 'joined')
        .neq('user_id', currentUserId);
      for (const participant of existing || []) {
        if (!participant.peer_id || participant.peer_id === myPeerIdRef.current) continue;
        authorizedPeersRef.current.add(`${participant.user_id}:${participant.peer_id}`);
        if (myPeerIdRef.current < participant.peer_id) {
          await makeOfferRef.current(participant.peer_id, participant.user_id, participant.display_name);
        } else {
          const pc = await getPCRef.current(participant.peer_id, participant.user_id, participant.display_name);
          setTimeout(() => {
            if (!pc.remoteDescription && pc.signalingState === 'stable') {
              void makeOfferRef.current(participant.peer_id, participant.user_id, participant.display_name);
            }
          }, 1200);
        }
      }
    });

    const roomChannel = supabase.channel(`room-status-${room.id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'conference_rooms', filter: `id=eq.${room.id}` }, ({ new: row }: any) => {
        if (row.status === 'ended' && !leavingFromDbRef.current) {
          leavingFromDbRef.current = true;
          for (const peer of peersRef.current.values()) peer.pc.close();
          peersRef.current.clear();
          toast.error('جلسه پایان یافت');
          onLeave();
          return;
        }
        if (row.host_id) setHostId(row.host_id as string);
        if (typeof row.chat_enabled === 'boolean') setChatEnabled(row.chat_enabled);
        if (typeof row.speaking_limit_enabled === 'boolean') setSpeakingLimitEnabled(row.speaking_limit_enabled);
        setPresenterUserId(row.presenter_user_id ?? null);
        setDbPinnedUserId(row.pinned_user_id ?? null);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      supabase.removeChannel(roomChannel);
      authorizedPeersRef.current.clear();
      for (const peer of peersRef.current.values()) peer.pc.close();
      peersRef.current.clear();
    };
  }, [room.id, currentUserId, currentUserName, myPeerId, supabase, validateSignalSender]);

  const [participants, setParticipants] = useState<ConferenceParticipant[]>([]);
  useEffect(() => {
    const load = async () => {
      const { data, error } = await supabase
        .from('conference_participants')
        .select('*')
        .eq('room_id', room.id)
        .eq('status', 'joined');
      if (error || !data) return;
      const rows = data as ConferenceParticipant[];
      setParticipants(rows);

      const own = rows.find(p => p.user_id === currentUserId);
      if (!own) {
        if (!leavingFromDbRef.current) {
          leavingFromDbRef.current = true;
          toast.error('دسترسی شما به جلسه پایان یافته است');
          for (const peer of peersRef.current.values()) peer.pc.close();
          peersRef.current.clear();
          onLeave();
        }
        return;
      }

      setMyRole(own.role as RoleType);
      setMyLimitSecs(Number((own as ConferenceParticipant & { speaking_limit_seconds?: number }).speaking_limit_seconds) || 60);
      if (own.is_muted && !mediaRef.current.isMuted) {
        localStreamRef.current?.getAudioTracks().forEach((track: MediaStreamTrack) => { track.enabled = false; });
        dispatch({ type: 'FORCE_MUTE' });
      }
      if (!own.is_hand_raised && mediaRef.current.isHandRaised) dispatch({ type: 'SET_HAND', value: false });
    };

    void load();
    const channel = supabase.channel(`conf-parts-${room.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conference_participants', filter: `room_id=eq.${room.id}` }, () => { void load(); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [room.id, currentUserId, supabase, onLeave, dispatch, localStreamRef, mediaRef, peersRef, setMyRole, setMyLimitSecs]);

  return {
    participants,
    sendSignal,
    sendSignalRef,
    showTileReactionRef,
    stopScreenShareRef,
  };
}
