import { supabase } from '../../../lib/supabase';
import { log } from './types';

export function validateIceCandidate(c: unknown): c is RTCIceCandidateInit {
  if (!c || typeof c !== 'object') return false;
  const o = c as Record<string, unknown>;
  if (typeof o.candidate !== 'string' || o.candidate.length > 2000) return false;
  if ('sdpMid' in o && o.sdpMid !== null && typeof o.sdpMid !== 'string') return false;
  if ('sdpMLineIndex' in o && o.sdpMLineIndex !== null && !Number.isInteger(o.sdpMLineIndex)) return false;
  if ('usernameFragment' in o && o.usernameFragment !== null && typeof o.usernameFragment !== 'string') return false;
  return true;
}

export function validateSDP(sdp: unknown, expectedType: 'offer' | 'answer'): sdp is RTCSessionDescriptionInit {
  if (!sdp || typeof sdp !== 'object') return false;
  const o = sdp as Record<string, unknown>;
  if (o.type !== expectedType) return false;
  if (typeof o.sdp !== 'string' || o.sdp.length === 0 || o.sdp.length > 65536) return false;
  return true;
}

export function validateSignalPayload(
  payload: unknown,
  sessionId: string,
  lockedPeer: string | null,
): (Record<string, unknown> & { type: string; from: string }) | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  if (typeof p.type !== 'string' || p.type.length === 0 || p.type.length > 50) return null;
  if (typeof p.from !== 'string' || p.from.length === 0 || p.from.length > 200) return null;
  if (p.session !== sessionId) {
    log('[E2EE][SIGNAL]', `drop: session mismatch got=${p.session} want=${sessionId}`);
    return null;
  }
  if (lockedPeer !== null && p.from !== lockedPeer) {
    log('[E2EE][SIGNAL]', `drop: locked-peer mismatch from=${p.from} locked=${lockedPeer}`);
    return null;
  }
  return p as Record<string, unknown> & { type: string; from: string };
}

export function waitForSubscribed(
  ch: ReturnType<typeof supabase.channel>,
  timeoutMs = 9000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('channel subscribe timeout')), timeoutMs);
    ch.subscribe(status => {
      if (status === 'SUBSCRIBED') {
        clearTimeout(timer);
        resolve();
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        clearTimeout(timer);
        reject(new Error(`channel subscribe failed: ${status}`));
      }
    });
  });
}
