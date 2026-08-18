// @ts-nocheck
import { useEffect, useCallback } from 'react';
import { supabase } from '../../../lib/supabase';
import { invalidateAuthenticatedRTCConfigCache } from '../../../lib/authenticatedRtcConfig';
import toast from 'react-hot-toast';
import { v4 as uuidv4 } from 'uuid';
import { INVITE_TTL_MS, SUPPORTS_TRANSFORMS, logWarn, logError } from './types';
import type { UserProfile } from './types';
import { generateECDHKeyPair, exportPublicKey, randomHex } from './crypto';
import { ensureWorkerReady } from './transforms';
import { subscribeChannelOrThrow, safeRemoveChannel } from './signaling';
import type { ChannelPurpose } from './signaling';
import { dbgInfo, dbgWarn, dbgError, debugStoreSetSession, debugStoreReset } from './callDebugStore';

export function useE2EECallFlow(scope: Record<string, any>) {
  const {
    acceptTokenRef, autoAcceptRef, buildPC, callGenerationRef, currentUserId, currentUserName,
    doFullCleanup, doHangup, ecdhKeyPairRef, incomingCall, lockedPeerRef, myPeerIdRef,
    myPublicJWKRef, myRoleRef, offerSentRef, openSessionChannel, phase, phaseRef,
    sessionActiveRef, sessionIdRef, setE2eeStatus, setIncomingCall, setPhase, setSessionCode,
    setTargetUser, startLocalStream, workerRef
  } = scope;

  // ── Call flow ──────────────────────────────────────────────────────────
  const startCall = useCallback(async (target: UserProfile) => {
    if (!SUPPORTS_TRANSFORMS || !workerRef.current) {
      toast.error('مرورگر از RTCRtpScriptTransform پشتیبانی نمی‌کند');
      setE2eeStatus('unsupported');
      return;
    }
    try {
      // Increment generation for this new call
      const generation = ++callGenerationRef.current;
      debugStoreReset();
      debugStoreSetSession({ role: 'caller' });
      dbgInfo('lifecycle', 'call-starting', { targetUserId: target.user_id.slice(0, 8) });

      await ensureWorkerReady(workerRef.current);
      dbgInfo('worker', 'worker-health-check-passed');

      setTargetUser(target);
      myRoleRef.current = 'caller';
      debugStoreSetSession({ role: 'caller' });
      offerSentRef.current = false;
      invalidateAuthenticatedRTCConfigCache();

      const sessionId = uuidv4();
      sessionIdRef.current = sessionId;
      debugStoreSetSession({ sessionId, generation });
      setSessionCode(sessionId.slice(0, 8).toUpperCase());
      acceptTokenRef.current = randomHex(16);

      ecdhKeyPairRef.current = await generateECDHKeyPair();
      myPublicJWKRef.current = await exportPublicKey(ecdhKeyPairRef.current.publicKey);
      dbgInfo('crypto', 'ecdh-keypair-generated');

      if (generation !== callGenerationRef.current) return;

      const stream = await startLocalStream(generation);
      if (!stream) { doFullCleanup(); return; }

      if (generation !== callGenerationRef.current) { stream.getTracks().forEach(t => t.stop()); return; }

      const ch = openSessionChannel(sessionId, generation);
      const sessChId = uuidv4();
      await subscribeChannelOrThrow(ch!, {
        attemptId:    sessChId,
        purpose:      'session',
        generation,
        sessionId,
        channelId:    sessChId,
        topicSummary: `e2ee-sess-${sessionId.slice(0, 8)}`,
        startedAt:    Date.now(),
      });

      if (generation !== callGenerationRef.current) return;

      const pc = await buildPC(generation, sessionId);
      if (!pc) return;

      sessionActiveRef.current = true;

      // Send ring to both the session inbox and the global inbox.
      // Two channels are needed because the callee may be subscribed to either
      // (depending on whether the page is active or in the background/PWA).
      const ringPayload = {
        from: myPeerIdRef.current, sessionId, targetUserId: target.user_id,
        callerName: currentUserName, callerId: currentUserId,
        acceptToken: acceptTokenRef.current, expiresAt: Date.now() + INVITE_TTL_MS,
      };

      const inboxId  = uuidv4();
      const globalId = uuidv4();
      const calleeInbox       = supabase.channel(`e2ee-inbox-${target.user_id}`,        { config: { broadcast: { self: false } } });
      const calleeGlobalInbox = supabase.channel(`e2ee-global-inbox-${target.user_id}`, { config: { broadcast: { self: false } } });

      // Subscribe both, then send ring on whichever succeeds
      const sendRing = (c: ReturnType<typeof supabase.channel>, cId: string, purpose: ChannelPurpose) =>
        subscribeChannelOrThrow(c, {
          attemptId: cId, purpose, generation, sessionId,
          channelId: cId, topicSummary: `ring-${target.user_id.slice(0, 8)}`, startedAt: Date.now(),
        }).then(() => {
          c.send({ type: 'broadcast', event: 'e2ee-ring', payload: ringPayload });
          return safeRemoveChannel(c, cId, 3000);
        }).catch(() => { void safeRemoveChannel(c, cId); });

      void sendRing(calleeInbox,       inboxId,  'callee-inbox');
      void sendRing(calleeGlobalInbox, globalId, 'callee-global-inbox');

      setPhase('outgoing_ring');
      dbgInfo('lifecycle', 'ring-sent', { targetUserId: target.user_id.slice(0, 8) });

      const capturedSessionId = sessionId;
      setTimeout(() => {
        if (sessionIdRef.current === capturedSessionId && phaseRef.current === 'outgoing_ring') {
          dbgWarn('lifecycle', 'invite-expired');
          doFullCleanup('invite_expired');
        }
      }, INVITE_TTL_MS);
    } catch (e) {
      logError('[E2EE][ERROR]', 'startCall failed:', e);
      dbgError('lifecycle', 'start-call-failed', { error: String(e) });
      toast.error('خطا در شروع تماس');
      doFullCleanup('key_exchange');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUserId, currentUserName, doFullCleanup, doHangup]);

  const acceptCall = useCallback(async () => {
    const ic = incomingCall;
    if (!ic) return;
    if (Date.now() > ic.expiresAt) {
      setIncomingCall(null); setPhase('idle');
      toast.error('دعوت به تماس منقضی شده');
      return;
    }
    if (!SUPPORTS_TRANSFORMS || !workerRef.current) {
      toast.error('مرورگر از تماس امن پشتیبانی نمی‌کند');
      return;
    }
    try {
      const generation = ++callGenerationRef.current;
      debugStoreReset();
      debugStoreSetSession({ role: 'callee' });
      dbgInfo('lifecycle', 'call-accepting');

      await ensureWorkerReady(workerRef.current);
      dbgInfo('worker', 'worker-health-check-passed');

      myRoleRef.current = 'callee';
      debugStoreSetSession({ role: 'callee' });
      sessionIdRef.current = ic.sessionId;
      debugStoreSetSession({ sessionId: ic.sessionId, generation });
      lockedPeerRef.current = ic.from;
      offerSentRef.current = false;
      invalidateAuthenticatedRTCConfigCache();

      ecdhKeyPairRef.current = await generateECDHKeyPair();
      myPublicJWKRef.current = await exportPublicKey(ecdhKeyPairRef.current.publicKey);
      dbgInfo('crypto', 'ecdh-keypair-generated');

      if (generation !== callGenerationRef.current) return;

      const stream = await startLocalStream(generation);
      if (!stream) { doFullCleanup(); setIncomingCall(null); return; }

      if (generation !== callGenerationRef.current) { stream.getTracks().forEach(t => t.stop()); return; }

      const ch = openSessionChannel(ic.sessionId, generation);
      const sessChId = uuidv4();
      await subscribeChannelOrThrow(ch!, {
        attemptId:    sessChId,
        purpose:      'session',
        generation,
        sessionId:    ic.sessionId,
        channelId:    sessChId,
        topicSummary: `e2ee-sess-${ic.sessionId.slice(0, 8)}`,
        startedAt:    Date.now(),
      });

      if (generation !== callGenerationRef.current) return;

      const pc = await buildPC(generation, ic.sessionId);
      if (!pc) { setIncomingCall(null); return; }

      sessionActiveRef.current = true;

      ch!.send({
        type: 'broadcast', event: 'e2ee-signal',
        payload: { type: 'accepted', from: myPeerIdRef.current, session: ic.sessionId, data: { acceptToken: ic.acceptToken, targetUserId: ic.callerId } },
      });
      dbgInfo('signaling', 'accepted-signal-sent');

      setIncomingCall(null);
      setTargetUser({ user_id: ic.callerId, full_name: ic.callerName, email: null });
      setPhase('connecting');
    } catch (e) {
      logError('[E2EE][ERROR]', 'acceptCall failed:', e);
      dbgError('lifecycle', 'accept-call-failed', { error: String(e) });
      toast.error('خطا در پذیرش تماس');
      doFullCleanup('key_exchange');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomingCall, doFullCleanup]);

  // ── Auto-accept when arriving from global overlay ──────────────────────
  useEffect(() => {
    if (phase === 'incoming_ring' && incomingCall && autoAcceptRef.current) {
      autoAcceptRef.current = false;
      acceptCall();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, incomingCall, acceptCall]);

  const rejectCall = useCallback(() => {
    const ic = incomingCall;
    if (!ic) return;
    setIncomingCall(null);
    setPhase('idle');
    const rejChId = uuidv4();
    const ch = supabase.channel(`e2ee-sess-${ic.sessionId}`, { config: { broadcast: { self: false } } });
    subscribeChannelOrThrow(ch, {
      attemptId:    rejChId,
      purpose:      'reject-temp',
      generation:   callGenerationRef.current,
      sessionId:    ic.sessionId,
      channelId:    rejChId,
      topicSummary: `e2ee-sess-${ic.sessionId.slice(0, 8)}`,
      startedAt:    Date.now(),
    }).then(() => {
      ch.send({ type: 'broadcast', event: 'e2ee-signal', payload: { type: 'rejected', from: myPeerIdRef.current, session: ic.sessionId, data: {} } });
      return safeRemoveChannel(ch, rejChId, 1500);
    }).catch(err => {
      logWarn('[E2EE][SIGNAL]', 'reject channel subscribe failed:', err);
      void safeRemoveChannel(ch, rejChId);
    });
  }, [incomingCall]);

  return {
    acceptCall, rejectCall, startCall
  };
}
