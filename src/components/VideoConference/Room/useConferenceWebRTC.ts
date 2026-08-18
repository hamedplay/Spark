// @ts-nocheck
import { useState, useEffect, useRef, useCallback } from 'react';
import { startDiagnostics, stopDiagnostics, attemptICERestart } from '../../../lib/webrtcDiagnostics';
import toast from 'react-hot-toast';
import type { ConferenceParticipant, PeerConnection, Reaction } from '../types';
import { type RoleType } from './roleConstants';
import { MAX_PARTICIPANTS, setPreferredCodecs } from './webrtcHelpers';

export function useConferenceWebRTC(scope: Record<string, any>) {
  const {
    broadcastStateRef, channelRef, currentUserId, currentUserName, dispatch, iceCandidateQueue,
    localStreamRef, mediaRef, myPeerId, myPeerIdRef, onLeave, peersRef,
    room, rtcConfigReadyRef, rtcConfigRef, setChatEnabled, setHandRaiseQueue, setHostId,
    setMessages, setMyLimitSecs, setMyQuality, setMyRole, setPeerDiagnostics, setPeers,
    setReactions, setSpeakingLimitEnabled, setUnreadCount, sidePanelRef, supabase
  } = scope;

  // ── WebRTC helpers ─────────────────────────────────────────────────────────
  const sendSignal = useCallback((toPeerId: string | null, type: string, data: object) => {
    const payload = {
      from: myPeerIdRef.current,
      from_user_id: currentUserId,
      from_name: currentUserName,
      to: toPeerId,
      type,
      data,
    };
    channelRef.current?.send({ type: 'broadcast', event: 'signal', payload });
  }, [currentUserId, currentUserName, room.id]);

  const buildPC = useCallback(async (remotePeerId: string, remoteUserId: string, remoteDisplayName: string): Promise<RTCPeerConnection> => {
    await rtcConfigReadyRef.current;
    console.log(`[WRTCDiag] buildPC → peer=${remotePeerId} name="${remoteDisplayName}" rtcConfig=`, JSON.stringify(rtcConfigRef.current));
    const pc = new RTCPeerConnection(rtcConfigRef.current);

    const localTracks = localStreamRef.current.getTracks();
    console.log(`[WRTCDiag] addTrack × ${localTracks.length} → peer=${remotePeerId}`, localTracks.map(t => `${t.kind}:${t.id}:enabled=${t.enabled}`));
    localStreamRef.current.getTracks().forEach(track => pc.addTrack(track, localStreamRef.current));

    // تنظیم اولویت codec پس از addTrack
    setPreferredCodecs(pc);

    pc.ontrack = (e) => {
      console.log(`[WRTCDiag] ontrack ← peer=${remotePeerId} track.kind=${e.track.kind} track.id=${e.track.id} streams.length=${e.streams.length} stream0_id=${e.streams[0]?.id ?? 'NONE'}`);
      const stream = e.streams[0];
      if (!stream) {
        console.warn(`[WRTCDiag] ontrack: e.streams[0] is undefined for peer=${remotePeerId} — stream will NOT be set`);
        return;
      }
      const cur = peersRef.current.get(remotePeerId);
      if (cur) {
        console.log(`[WRTCDiag] ontrack: setting stream on peer=${remotePeerId} stream.id=${stream.id} tracks=`, stream.getTracks().map(t => `${t.kind}:${t.id}`));
        peersRef.current.set(remotePeerId, { ...cur, stream }); setPeers(new Map(peersRef.current));
      } else {
        console.warn(`[WRTCDiag] ontrack: peer=${remotePeerId} NOT found in peersRef — stream dropped`);
      }
    };

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        console.log(
          `[WRTCDiag][ICE-OUT] peer=${remotePeerId}` +
          ` | type=${e.candidate.type}` +
          ` | protocol=${e.candidate.protocol}` +
          ` | address=${e.candidate.address}` +
          ` | port=${e.candidate.port}` +
          ` | candidate="${e.candidate.candidate}"`
        );
        sendSignal(remotePeerId, 'ice', { candidate: e.candidate.toJSON() });
      } else {
        console.log(`[WRTCDiag][ICE-OUT] gathering complete (null candidate) peer=${remotePeerId} iceGatheringState=${pc.iceGatheringState}`);
      }
    };

    pc.onconnectionstatechange = () => {
      console.log(`[WRTCDiag][STATE] connectionState → peer=${remotePeerId} state=${pc.connectionState}`);
      const cur = peersRef.current.get(remotePeerId);
      if (cur) { peersRef.current.set(remotePeerId, { ...cur, connectionState: pc.connectionState }); setPeers(new Map(peersRef.current)); }
      if (pc.connectionState === 'connected') toast.success(`${remoteDisplayName} وارد شد`);
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        pc.getStats().then(stats => {
          let selectedPairId: string | null = null;
          const candidates: Record<string, any> = {};
          const pairs: any[] = [];
          stats.forEach(r => {
            if (r.type === 'local-candidate') {
              candidates[r.id] = { dir: 'local', type: r.candidateType, protocol: r.protocol, address: r.address, port: r.port };
              console.log(`[WRTCDiag][STATS] local-candidate id=${r.id} type=${r.candidateType} protocol=${r.protocol} address=${r.address} port=${r.port}`);
            }
            if (r.type === 'remote-candidate') {
              candidates[r.id] = { dir: 'remote', type: r.candidateType, protocol: r.protocol, address: r.address, port: r.port };
              console.log(`[WRTCDiag][STATS] remote-candidate id=${r.id} type=${r.candidateType} protocol=${r.protocol} address=${r.address} port=${r.port}`);
            }
            if (r.type === 'candidate-pair') {
              pairs.push(r);
              if (r.nominated && r.state === 'succeeded') selectedPairId = r.id;
              console.log(
                `[WRTCDiag][STATS] candidate-pair id=${r.id}` +
                ` state=${r.state} nominated=${r.nominated}` +
                ` local=${r.localCandidateId} remote=${r.remoteCandidateId}` +
                ` bytesSent=${r.bytesSent ?? 'n/a'} bytesReceived=${r.bytesReceived ?? 'n/a'}` +
                ` RTT=${r.currentRoundTripTime ?? 'n/a'} totalRTT=${r.totalRoundTripTime ?? 'n/a'}`
              );
            }
          });
          if (selectedPairId) {
            const pair = pairs.find(p => p.id === selectedPairId);
            const lc = pair ? candidates[pair.localCandidateId]  : null;
            const rc = pair ? candidates[pair.remoteCandidateId] : null;
            console.log(
              `[WRTCDiag][STATS] SELECTED PAIR peer=${remotePeerId}` +
              ` | local=${lc?.type}/${lc?.protocol}/${lc?.address}:${lc?.port}` +
              ` | remote=${rc?.type}/${rc?.protocol}/${rc?.address}:${rc?.port}` +
              ` | bytesSent=${pair?.bytesSent} bytesReceived=${pair?.bytesReceived} RTT=${pair?.currentRoundTripTime}`
            );
          } else {
            console.warn(
              `[WRTCDiag][STATS] NO selected candidate-pair peer=${remotePeerId}` +
              ` | total_pairs=${pairs.length}` +
              ` | pair_states: [${pairs.map(p => `${p.id}:${p.state}(nominated=${p.nominated})`).join(', ')}]`
            );
          }
        }).catch(err => console.warn(`[WRTCDiag][STATS] getStats failed peer=${remotePeerId}`, err));
      }
      if (pc.connectionState === 'disconnected') {
        // First try ICE restart before giving up
        setTimeout(async () => {
          if (pc.connectionState !== 'disconnected' && pc.connectionState !== 'failed') return;
          const restarted = await attemptICERestart(pc, (offer) => {
            sendSignalRef.current(remotePeerId, 'offer', { sdp: offer, iceRestart: true });
          });
          if (!restarted) {
            // ICE restart not possible — wait a bit more then clean up
            setTimeout(() => {
              if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
                stopDiagnostics(remotePeerId);
                pc.close();
                peersRef.current.delete(remotePeerId);
                setPeers(new Map(peersRef.current));
                sendSignalRef.current(null, 'peer_left', { peerId: remotePeerId, displayName: remoteDisplayName });
                supabase.from('conference_participants')
                  .update({ status: 'left', left_at: new Date().toISOString() })
                  .eq('room_id', room.id).eq('user_id', remoteUserId)
                  .then(() => {});
              }
            }, 15000);
          }
        }, 5000);
      }
      if (pc.connectionState === 'failed') {
        stopDiagnostics(remotePeerId);
        setTimeout(() => { if (pc.connectionState === 'failed') { pc.close(); peersRef.current.delete(remotePeerId); setPeers(new Map(peersRef.current)); } }, 2000);
      }
    };

    pc.oniceconnectionstatechange = () => {
      const s = pc.iceConnectionState;
      console.log(`[WRTCDiag][STATE] iceConnectionState → peer=${remotePeerId} state=${s}`);
      if (s === 'failed') {
        console.warn(`[WRTCDiag][ICE-FAIL] iceConnectionState=failed peer=${remotePeerId} — dumping getStats`);
        pc.getStats().then(stats => {
          stats.forEach(r => {
            if (r.type === 'candidate-pair') {
              console.warn(
                `[WRTCDiag][ICE-FAIL] candidate-pair id=${r.id}` +
                ` state=${r.state} nominated=${r.nominated}` +
                ` writable=${r.writable} priority=${r.priority}` +
                ` bytesSent=${r.bytesSent ?? 0} bytesReceived=${r.bytesReceived ?? 0}`
              );
            }
          });
        }).catch(() => {});
      }
    };

    pc.onsignalingstatechange = () => {
      console.log(`[WRTCDiag][STATE] signalingState → peer=${remotePeerId} state=${pc.signalingState}`);
    };

    pc.onicegatheringstatechange = () => {
      console.log(`[WRTCDiag][STATE] iceGatheringState → peer=${remotePeerId} state=${pc.iceGatheringState}`);
    };

    const conn: PeerConnection = { peerId: remotePeerId, userId: remoteUserId, displayName: remoteDisplayName, pc, stream: null, screenStream: null, isScreenSharing: false, isMuted: false, isVideoOff: false, isHandRaised: false, connectionState: 'new', networkQuality: 'good', speakingSeconds: 0, audioLevel: 0 };
    peersRef.current.set(remotePeerId, conn);
    setPeers(new Map(peersRef.current));

    // Start diagnostics — update state every 5s
    startDiagnostics(pc, remotePeerId, (d) => {
      setPeerDiagnostics(prev => new Map(prev).set(remotePeerId, d));
    });

    return pc;
  }, [sendSignal]);

  const getPC = useCallback(async (remotePeerId: string, remoteUserId: string, remoteDisplayName: string): Promise<RTCPeerConnection> => {
    const cur = peersRef.current.get(remotePeerId);
    if (cur && cur.pc.connectionState !== 'failed' && cur.pc.connectionState !== 'closed') return cur.pc;
    return buildPC(remotePeerId, remoteUserId, remoteDisplayName);
  }, [buildPC]);

  const flushICE = useCallback(async (remotePeerId: string) => {
    const q = iceCandidateQueue.current.get(remotePeerId) || [];
    console.log(`[WRTCDiag][ICE-FLUSH] peer=${remotePeerId} queued=${q.length} hasRemoteDesc=${!!peersRef.current.get(remotePeerId)?.pc?.remoteDescription}`);
    if (!q.length) return;
    const pc = peersRef.current.get(remotePeerId)?.pc;
    if (!pc?.remoteDescription) return;
    for (const c of q) {
      console.log(
        `[WRTCDiag][ICE-FLUSH] addIceCandidate peer=${remotePeerId}` +
        ` | typeof=${typeof c}` +
        ` | json=${JSON.stringify(c)}`
      );
      await pc.addIceCandidate(new RTCIceCandidate(c)).then(() => {
        console.log(`[WRTCDiag][ICE-FLUSH] addIceCandidate SUCCESS peer=${remotePeerId}`);
      }).catch((err) => {
        console.warn(`[WRTCDiag][ICE-FLUSH] addIceCandidate FAILED peer=${remotePeerId}`, err);
      });
    }
    iceCandidateQueue.current.delete(remotePeerId);
    console.log(`[WRTCDiag][ICE-FLUSH] done — flushed ${q.length} candidates for peer=${remotePeerId}`);
  }, []);

  const makeOffer = useCallback(async (remotePeerId: string, remoteUserId: string, remoteDisplayName: string) => {
    const pc = await getPC(remotePeerId, remoteUserId, remoteDisplayName);
    console.log(`[WRTCDiag] makeOffer → peer=${remotePeerId} signalingState=${pc.signalingState}`);
    if (pc.signalingState !== 'stable') {
      console.warn(`[WRTCDiag] makeOffer SKIPPED — signalingState=${pc.signalingState} peer=${remotePeerId}`);
      return;
    }
    try {
      const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
      await pc.setLocalDescription(offer);
      console.log(`[WRTCDiag] makeOffer: offer created and set, SENDING to peer=${remotePeerId}`);
      sendSignalRef.current(remotePeerId, 'offer', { sdp: pc.localDescription });
    } catch (e) { console.error('makeOffer failed', e); }
  }, [getPC]);

  // Stable refs — updated every render
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

  // ── Channel setup ──────────────────────────────────────────────────────────
  useEffect(() => {
    const ch = supabase.channel(`conf-${room.id}`, {
      config: { broadcast: { self: false } },
    });
    channelRef.current = ch;

    ch.on('broadcast', { event: 'signal' }, ({ payload }) => {
      if (payload.to !== null && payload.to !== myPeerIdRef.current) return;
      if (payload.from === myPeerIdRef.current) return;
      const { from, from_user_id, from_name, type, data } = payload;

      (async () => {
        if (type === 'join') {
          console.log(`[WRTCDiag] RECV join ← from=${from} name="${from_name}" myPeerId=${myPeerIdRef.current} willOffer=${myPeerIdRef.current < from}`);
          // Reject new peers if room is at capacity
          if (peersRef.current.size >= MAX_PARTICIPANTS - 1) {
            console.warn(`[WebRTC] Ignoring join from ${from_name} — room at capacity (${MAX_PARTICIPANTS})`);
            return;
          }
          if (myPeerIdRef.current < from) {
            await makeOfferRef.current(from, from_user_id, from_name);
          } else {
            await getPCRef.current(from, from_user_id, from_name);
          }

        } else if (type === 'offer') {
          console.log(`[WRTCDiag] RECV offer ← from=${from} name="${from_name}" iceRestart=${data.iceRestart ?? false}`);
          const pc = await getPCRef.current(from, from_user_id, from_name);
          console.log(`[WRTCDiag] offer: pc.signalingState=${pc.signalingState} peer=${from}`);
          try {
            if (pc.signalingState === 'have-local-offer') {
              if (myPeerIdRef.current < from) {
                console.log(`[WRTCDiag] offer: rollback local offer for peer=${from}`);
                await pc.setLocalDescription({ type: 'rollback' } as RTCSessionDescriptionInit);
              } else {
                console.warn(`[WRTCDiag] offer: SKIPPED (glare resolution) peer=${from} myPeerId=${myPeerIdRef.current}`);
                return;
              }
            }
            if (pc.signalingState !== 'stable') {
              console.warn(`[WRTCDiag] offer: SKIPPED signalingState=${pc.signalingState} peer=${from}`);
              return;
            }
            await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
            console.log(`[WRTCDiag] offer: setRemoteDescription done, creating answer for peer=${from}`);
            await flushICERef.current(from);
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            console.log(`[WRTCDiag] SEND answer → to=${from}`);
            sendSignalRef.current(from, 'answer', { sdp: pc.localDescription });
          } catch (e) { console.error('offer error', e); }

        } else if (type === 'answer') {
          console.log(`[WRTCDiag] RECV answer ← from=${from} signalingState=${peersRef.current.get(from)?.pc.signalingState}`);
          const cur = peersRef.current.get(from);
          if (cur?.pc.signalingState === 'have-local-offer') {
            try {
              await cur.pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
              console.log(`[WRTCDiag] answer: setRemoteDescription done for peer=${from}`);
              await flushICERef.current(from);
            }
            catch (e) { console.error('answer error', e); }
          } else {
            console.warn(`[WRTCDiag] answer: IGNORED — pc not found or signalingState=${peersRef.current.get(from)?.pc.signalingState} for peer=${from}`);
          }

        } else if (type === 'ice') {
          const cur = peersRef.current.get(from);
          if (cur?.pc) {
            if (cur.pc.remoteDescription) {
              console.log(
                `[WRTCDiag][ICE-IN] RECV ice peer=${from} → addIceCandidate` +
                ` | typeof_data.candidate=${typeof data.candidate}` +
                ` | json=${JSON.stringify(data.candidate)}`
              );
              cur.pc.addIceCandidate(new RTCIceCandidate(data.candidate)).then(() => {
                console.log(`[WRTCDiag][ICE-IN] addIceCandidate SUCCESS peer=${from}`);
              }).catch((err) => {
                console.warn(`[WRTCDiag][ICE-IN] addIceCandidate FAILED peer=${from}`, err);
              });
            } else {
              console.log(
                `[WRTCDiag][ICE-IN] RECV ice peer=${from} → QUEUED (no remoteDesc)` +
                ` | typeof_data.candidate=${typeof data.candidate}` +
                ` | json=${JSON.stringify(data.candidate)}`
              );
              const q = iceCandidateQueue.current.get(from) || [];
              q.push(data.candidate);
              iceCandidateQueue.current.set(from, q);
            }
          } else {
            console.warn(`[WRTCDiag][ICE-IN] RECV ice peer=${from} → DROPPED (no pc found) json=${JSON.stringify(data.candidate)}`);
          }

        } else if (type === 'leave') {
          const cur = peersRef.current.get(from);
          if (cur) { cur.pc.close(); peersRef.current.delete(from); setPeers(new Map(peersRef.current)); toast(`${from_name} جلسه را ترک کرد`); }

        } else if (type === 'peer_left') {
          const targetPeerId = data.peerId as string;
          const cur = peersRef.current.get(targetPeerId);
          if (cur) { cur.pc.close(); peersRef.current.delete(targetPeerId); setPeers(new Map(peersRef.current)); }

        } else if (type === 'end') {
          for (const p of peersRef.current.values()) p.pc.close();
          peersRef.current.clear();
          toast.error('میزبان جلسه را پایان داد');
          onLeave();

        } else if (type === 'state') {
          const cur = peersRef.current.get(from);
          if (cur) {
            const wasHandRaised = cur.isHandRaised;
            peersRef.current.set(from, { ...cur, isMuted: data.isMuted, isVideoOff: data.isVideoOff, isHandRaised: data.isHandRaised });
            setPeers(new Map(peersRef.current));
            // Update hand raise queue on state changes
            if (data.isHandRaised && !wasHandRaised) {
              setHandRaiseQueue(q => [...q.filter(e => e.peerId !== from), { peerId: from, name: from_name, time: Date.now() }]);
            } else if (!data.isHandRaised && wasHandRaised) {
              setHandRaiseQueue(q => q.filter(e => e.peerId !== from));
            }
          }

        } else if (type === 'chat') {
          setMessages(prev => [...prev, data]);
          if (sidePanelRef.current !== 'chat') setUnreadCount(c => c + 1);

        } else if (type === 'reaction') {
          const r: Reaction = { ...data, x: Math.random() * 80 + 10, y: Math.random() * 60 + 20, createdAt: Date.now(), expiresAt: Date.now() + 3000 };
          setReactions(prev => [...prev, r]);
          setTimeout(() => setReactions(prev => prev.filter(x => x.id !== r.id)), 3000);
          showTileReactionRef.current(data.userId, data.emoji);

        } else if (type === 'host_mute_all') {
          localStreamRef.current.getAudioTracks().forEach(t => { t.enabled = false; });
          dispatch({ type: 'FORCE_MUTE' });
          toast('میزبان درخواست قطع میکروفون داد');

        } else if (type === 'lower_hand') {
          // Host asked us to lower our hand
          dispatch({ type: 'SET_HAND', value: false });
          broadcastStateRef.current(mediaRef.current.isMuted, mediaRef.current.isVideoOff, false);
          toast('میزبان دست شما را پایین آورد');

        } else if (type === 'host_transfer') {
          setHostId(data.newHostUserId as string);
          if (data.newHostUserId === currentUserId) {
            setMyRole('host');
            toast.success('شما به عنوان میزبان جدید انتخاب شدید');
          } else {
            toast(`میزبانی به ${data.newHostName} منتقل شد`);
          }

        } else if (type === 'kick') {
          toast.error('شما توسط میزبان از جلسه خارج شدید');
          for (const p of peersRef.current.values()) p.pc.close();
          peersRef.current.clear();
          onLeave();

        } else if (type === 'role_change') {
          if (data.targetUserId === currentUserId) {
            setMyRole(data.newRole as RoleType);
            const labels: Record<string, string> = { admin: 'مدیر', moderator: 'ناظر', member: 'عضو', guest: 'مهمان', host: 'میزبان' };
            toast(`نقش شما به "${labels[data.newRole] || data.newRole}" تغییر یافت`);
          }
        } else if (type === 'chat_toggle') {
          setChatEnabled(data.enabled as boolean);
        } else if (type === 'speaking_limit_change') {
          if (data.targetUserId === currentUserId) {
            const secs = Math.max(10, Math.min(600, Number(data.limitSecs) || 60));
            setMyLimitSecs(secs);
            toast(`محدودیت صحبت شما به ${secs} ثانیه تغییر یافت`);
          }
        }
      })();
    })
    .subscribe(async (status) => {
      console.log(`[WRTCDiag] channel conf-${room.id} subscribe status=${status} myPeerId=${myPeerIdRef.current}`);
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        // Realtime channel dropped — rejoin after a short delay
        setTimeout(() => ch.subscribe(), 3000);
        return;
      }
      if (status !== 'SUBSCRIBED') return;

      console.log(`[WRTCDiag] SEND join → broadcast myPeerId=${myPeerId} userId=${currentUserId}`);
      sendSignalRef.current(null, 'join', { userId: currentUserId, displayName: currentUserName, peerId: myPeerId });

      await new Promise(r => setTimeout(r, 500));

      const { data: existing } = await supabase
        .from('conference_participants')
        .select('user_id, display_name, peer_id')
        .eq('room_id', room.id)
        .eq('status', 'joined')
        .neq('user_id', currentUserId);

      console.log(`[WRTCDiag] existing participants from DB: count=${existing?.length ?? 0}`, existing?.map(p => `peer=${p.peer_id} user=${p.user_id}`));

      if (existing) {
        for (const p of existing) {
          if (!p.peer_id || p.peer_id === myPeerId) {
            console.log(`[WRTCDiag] skipping existing participant peer_id=${p.peer_id} (null or self)`);
            continue;
          }
          console.log(`[WRTCDiag] existing participant peer=${p.peer_id} myPeerId=${myPeerIdRef.current} willOffer=${myPeerIdRef.current < p.peer_id}`);
          if (myPeerIdRef.current < p.peer_id) {
            await makeOfferRef.current(p.peer_id, p.user_id, p.display_name);
          } else {
            const existingPC = await getPCRef.current(p.peer_id, p.user_id, p.display_name);
            setTimeout(async () => {
              console.log(`[WRTCDiag] delayed offer check for peer=${p.peer_id} hasRemoteDesc=${!!existingPC.remoteDescription} signalingState=${existingPC.signalingState}`);
              if (!existingPC.remoteDescription && existingPC.signalingState === 'stable') {
                await makeOfferRef.current(p.peer_id, p.user_id, p.display_name);
              }
            }, 1500);
          }
        }
      }
    });

    const roomCh = supabase.channel(`room-status-${room.id}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'conference_rooms',
        filter: `id=eq.${room.id}`,
      }, ({ new: row }) => {
        if (row.status === 'ended') {
          for (const p of peersRef.current.values()) p.pc.close();
          peersRef.current.clear();
          toast.error('میزبان جلسه را پایان داد');
          onLeave();
        }
        // Sync host transfers that came through DB
        if (row.host_id && row.host_id !== room.host_id) {
          setHostId(row.host_id as string);
        }
        // Sync runtime chat toggle
        if (typeof row.chat_enabled === 'boolean') {
          setChatEnabled(row.chat_enabled);
        }
        // Sync speaking limit toggle
        if (typeof row.speaking_limit_enabled === 'boolean') {
          setSpeakingLimitEnabled(row.speaking_limit_enabled);
        }
      })
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'room_mod_actions',
        filter: `room_id=eq.${room.id}`,
      }, ({ new: row }) => {
        if (row.target_user_id !== currentUserId) return;
        if (row.action_type === 'kick') {
          toast.error('شما توسط میزبان از جلسه خارج شدید');
          for (const p of peersRef.current.values()) p.pc.close();
          peersRef.current.clear();
          onLeave();
        } else if (row.action_type === 'mute') {
          localStreamRef.current.getAudioTracks().forEach(t => { t.enabled = false; });
          dispatch({ type: 'FORCE_MUTE' });
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(ch);
      supabase.removeChannel(roomCh);
      for (const p of peersRef.current.values()) p.pc.close();
      peersRef.current.clear();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.id]);

  // Participants list for UI
  const [participants, setParticipants] = useState<ConferenceParticipant[]>([]);
  useEffect(() => {
    const load = async () => {
      const { data } = await supabase.from('conference_participants').select('*').eq('room_id', room.id).eq('status', 'joined');
      if (data) setParticipants(data as ConferenceParticipant[]);
    };
    load();
    const ch = supabase.channel(`conf-parts-${room.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conference_participants', filter: `room_id=eq.${room.id}` }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [room.id]);


  // Quality
  useEffect(() => {
    const t = setInterval(async () => {
      let loss = 0, cnt = 0;
      for (const p of peersRef.current.values()) {
        try { const st = await p.pc.getStats(); st.forEach((s: any) => { if (s.type === 'inbound-rtp') { const tot = (s.packetsReceived||0)+(s.packetsLost||0); if (tot>0){loss+=(s.packetsLost||0)/tot*100;cnt++;} } }); } catch { /**/ }
      }
      const avg = cnt > 0 ? loss/cnt : 0;
      setMyQuality(avg<1?'excellent':avg<5?'good':avg<15?'fair':'poor');
    }, 5000);
    return () => clearInterval(t);
  }, []);

  return {
    participants, sendSignal, sendSignalRef, showTileReactionRef, stopScreenShareRef
  };
}
