// @ts-nocheck
import { supabase } from '../../../lib/supabase';
import toast from 'react-hot-toast';
import { ICE_QUEUE_MAX, logWarn, logError } from './types';
import { bytesToHex, hexToBytes } from './crypto';
import { validateIceCandidate, validateSDP, validateSignalPayload } from './signaling';
import { dbgInfo, dbgWarn, dbgError } from './callDebugStore';

export function useE2EESessionChannel(scope: Record<string, any>) {
  const {
    acceptTokenRef, auditTransceiverDirections, callGenerationRef, currentUserId, doFullCleanup, doHangup,
    doSetupKeys, flushICEQueue, iceCandidateQueue, lockedPeerRef, logSDPDirections, myPeerIdRef,
    myPublicJWKRef, myRoleRef, offerSentRef, pcRef, peerConnectionIdRef, phaseRef,
    saltRef, sessionChannelRef, sessionIdRef, setPhase
  } = scope;

  // ── Offer / Session channel ────────────────────────────────────────────
  const doSendOffer = async (capturedGeneration: number) => {
    const pc = pcRef.current;
    const ch = sessionChannelRef.current;
    if (!pc || !ch) return;
    if (capturedGeneration !== callGenerationRef.current) {
      dbgWarn('signaling', 'send-offer-stale', { capturedGeneration });
      return;
    }
    const salt = crypto.getRandomValues(new Uint8Array(16));
    saltRef.current = salt;
    const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
    await pc.setLocalDescription(offer);
    logSDPDirections(pc.localDescription?.sdp, 'caller:local-offer');
    dbgInfo('signaling', 'offer-sent', { sessionId: sessionIdRef.current.slice(0, 8) });
    ch.send({
      type: 'broadcast', event: 'e2ee-signal',
      payload: {
        type: 'offer', from: myPeerIdRef.current, session: sessionIdRef.current,
        data: { sdp: pc.localDescription, publicKey: myPublicJWKRef.current, salt: bytesToHex(salt) },
      },
    });
  };

  const openSessionChannel = (sessionId: string, capturedGeneration: number) => {
    const ch = supabase.channel(`e2ee-sess-${sessionId}`, { config: { broadcast: { self: false } } });
    sessionChannelRef.current = ch;
    dbgInfo('signaling', 'session-channel-created', { sessionId: sessionId.slice(0, 8) });

    ch.on('broadcast', { event: 'e2ee-signal' }, async ({ payload }) => {
      // Generation guard: ignore signals for stale sessions
      if (capturedGeneration !== callGenerationRef.current) {
        dbgWarn('signaling', 'stale-signal-ignored', { event: 'session-signal', capturedGeneration, currentGeneration: callGenerationRef.current });
        return;
      }
      if (sessionId !== sessionIdRef.current) {
        dbgWarn('signaling', 'stale-signal-ignored', { event: 'session-id-mismatch' });
        return;
      }

      const p = validateSignalPayload(payload, sessionIdRef.current, lockedPeerRef.current);
      if (!p) return;

      const type = p.type;
      const data = p.data as Record<string, unknown> | undefined;

      if (type === 'accepted' && myRoleRef.current === 'caller') {
        if (phaseRef.current !== 'outgoing_ring') return;
        if (offerSentRef.current) return;
        if ((data as Record<string, unknown>)?.acceptToken !== acceptTokenRef.current) return;
        if ((data as Record<string, unknown>)?.targetUserId !== currentUserId) return;
        lockedPeerRef.current = p.from;
        offerSentRef.current = true;
        dbgInfo('signaling', 'call-accepted-by-callee');
        setPhase('connecting');
        await doSendOffer(capturedGeneration);
      }

      else if (type === 'offer' && myRoleRef.current === 'callee') {
        if (!validateSDP(data?.sdp, 'offer')) return;
        if (typeof data?.publicKey !== 'string') return;
        if (typeof data?.salt !== 'string') return;
        const saltBytes = hexToBytes(data.salt as string);
        if (!saltBytes || saltBytes.length !== 16) return;
        const pc = pcRef.current;
        if (!pc || pc.signalingState !== 'stable') return;
        dbgInfo('signaling', 'offer-received', { signalingState: pc.signalingState });
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(data.sdp as RTCSessionDescriptionInit));
          logSDPDirections((data.sdp as RTCSessionDescriptionInit)?.sdp, 'callee:remote-offer');
          dbgInfo('signaling', 'remote-description-set-offer');
          await flushICEQueue(pc, peerConnectionIdRef.current);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          logSDPDirections(pc.localDescription?.sdp, 'callee:local-answer');
          dbgInfo('signaling', 'local-description-set-answer');
          auditTransceiverDirections(pc, 'callee:after-setLocalDescription');
          await doSetupKeys(data.publicKey as string, saltBytes, capturedGeneration);
          ch.send({
            type: 'broadcast', event: 'e2ee-signal',
            payload: { type: 'answer', from: myPeerIdRef.current, session: sessionIdRef.current, data: { sdp: pc.localDescription, publicKey: myPublicJWKRef.current } },
          });
          dbgInfo('signaling', 'answer-sent');
        } catch (e) {
          logError('[E2EE][ERROR]', 'offer handling:', e);
          dbgError('signaling', 'offer-handling-failed', { error: String(e) });
          doFullCleanup('key_exchange');
        }
      }

      else if (type === 'answer' && myRoleRef.current === 'caller') {
        if (!validateSDP(data?.sdp, 'answer')) return;
        if (typeof data?.publicKey !== 'string') return;
        if (!saltRef.current) return;
        const pc = pcRef.current;
        if (!pc || pc.signalingState !== 'have-local-offer') return;
        dbgInfo('signaling', 'answer-received');
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(data.sdp as RTCSessionDescriptionInit));
          logSDPDirections((data.sdp as RTCSessionDescriptionInit)?.sdp, 'caller:remote-answer');
          dbgInfo('signaling', 'remote-description-set-answer');
          await flushICEQueue(pc, peerConnectionIdRef.current);
          auditTransceiverDirections(pc, 'caller:after-setRemoteDescription');
          await doSetupKeys(data.publicKey as string, saltRef.current, capturedGeneration);
        } catch (e) {
          logError('[E2EE][ERROR]', 'answer handling:', e);
          dbgError('signaling', 'answer-handling-failed', { error: String(e) });
          doFullCleanup('key_exchange');
        }
      }

      else if (type === 'ice') {
        const candidate = data?.candidate;
        if (!validateIceCandidate(candidate)) return;
        const pc = pcRef.current;
        if (!pc) return;
        if (iceCandidateQueue.current.length >= ICE_QUEUE_MAX) return;
        dbgInfo('ice', 'ice-candidate-received');
        if (pc.remoteDescription) {
          await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(e => logWarn('[E2EE][ICE]', 'addIceCandidate failed:', e));
        } else {
          iceCandidateQueue.current.push(candidate);
        }
      }

      else if (type === 'hangup') {
        dbgInfo('lifecycle', 'peer-hangup');
        doHangup(false);
        toast('مخاطب تماس را قطع کرد');
      }

      else if (type === 'rejected') {
        dbgInfo('lifecycle', 'call-rejected-by-peer');
        doHangup(false);
        toast('مخاطب تماس را رد کرد');
      }
    });

    // Do NOT call ch.subscribe() here.
    // subscribeChannelOrThrow() is the single owner of subscribe for this channel.
    return ch;
  };

  return {
    openSessionChannel
  };
}
