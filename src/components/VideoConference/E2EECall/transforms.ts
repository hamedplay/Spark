import { SUPPORTS_TRANSFORMS, E2EE_DEBUG, log, logWarn, logError } from './types';
import type { DerivedKeys } from './types';

export interface PortRecord {
  port:  MessagePort;
  kind:  'audio' | 'video';
  role:  'sender' | 'receiver';
}

export function ensureWorkerReady(worker: Worker): Promise<void> {
  return new Promise((resolve) => {
    const { port1: testPort1, port2: testPort2 } = new MessageChannel();
    testPort1.start();
    let resolved = false;

    const timer = setTimeout(() => {
      if (!resolved) {
        testPort1.close();
        logWarn('[E2EE][WORKER]', 'ping timeout — worker alive check inconclusive, proceeding anyway');
        console.warn('[E2EE][WORKER] worker ping timeout — continuing (transform-level checks will verify pipeline)');
        resolve();
      }
    }, 3000);

    testPort1.addEventListener('message', (e: MessageEvent) => {
      if (!resolved && e.data?.type === 'pong') {
        resolved = true;
        clearTimeout(timer);
        testPort1.close();
        log('[E2EE][WORKER]', 'worker health check passed (pong received)');
        console.info('[E2EE][WORKER] worker health check passed ✅');
        resolve();
      }
    });

    worker.postMessage({ type: 'ping', testPort: testPort2 }, [testPort2]);
    console.info('[E2EE][WORKER] sending ping to worker via test port...');
  });
}

export function attachSenderTransform(
  sender: RTCRtpSender,
  worker: Worker,
  debug: boolean,
): PortRecord | null {
  if (!SUPPORTS_TRANSFORMS || !sender.track) return null;
  const kind = sender.track.kind as 'audio' | 'video';
  if (kind !== 'audio' && kind !== 'video') {
    logWarn('[E2EE][XFORM]', `unknown sender track kind=${sender.track.kind} — skipping`);
    return null;
  }
  const { port1, port2 } = new MessageChannel();
  sender.transform = new RTCRtpScriptTransform(worker, { role: 'sender', port: port2 }, [port2]);
  port1.start();

  const initTimer = setTimeout(() => {
    logWarn('[E2EE][XFORM]', `sender init-ready timeout (5s) kind=${kind} — worker may not have received init`);
    console.warn(`[E2EE][XFORM] sender init-ready timeout (5s) for ${kind} — transform may not be active`);
  }, 5000);

  port1.addEventListener('message', e => {
    const { type } = e.data || {};
    if (type === 'ready') {
      clearTimeout(initTimer);
      log('[E2EE][XFORM]', `sender init ack received kind=${kind}`);
      console.info(`[E2EE][XFORM] sender init ack (ready) received kind=${kind} ✅`);
    } else if (type === 'log') {
      const { level, tag, msg } = e.data;
      if (level === 'error') logError(tag, msg);
      else if (level === 'warn') logWarn(tag, msg);
      else log(tag, msg);
    } else if (type === 'encrypt-ready') {
      log('[E2EE][XFORM]', `encrypt-ready kind=${kind}`);
    } else if (type === 'encrypt-error') {
      logError('[E2EE][XFORM]', `encrypt-error kind=${kind}:`, e.data.message);
    } else if (type === 'version-mismatch') {
      logError('[E2EE][XFORM]', `version-mismatch sender kind=${kind} got=0x${e.data.version?.toString(16)}`);
    } else if (type === 'counter-exhausted') {
      logError('[E2EE][XFORM]', `counter-exhausted sender kind=${kind}`);
    }
  });

  port1.postMessage({ type: 'init', debug, media: kind });
  log('[E2EE][XFORM]', `sender transform attached trackId=${sender.track.id} kind=${kind}`);
  console.info(`[E2EE][XFORM] sender transform attached trackId=${sender.track.id} kind=${kind}`);
  return { port: port1, kind, role: 'sender' };
}

export function attachReceiverTransform(
  receiver: RTCRtpReceiver,
  worker: Worker,
  debug: boolean,
): PortRecord | null {
  if (!SUPPORTS_TRANSFORMS) return null;
  const kind = receiver.track.kind as 'audio' | 'video';
  if (kind !== 'audio' && kind !== 'video') {
    logWarn('[E2EE][XFORM]', `unknown receiver track kind=${receiver.track.kind} — skipping`);
    return null;
  }
  const { port1, port2 } = new MessageChannel();
  receiver.transform = new RTCRtpScriptTransform(worker, { role: 'receiver', port: port2 }, [port2]);
  port1.start();

  const initTimer = setTimeout(() => {
    logWarn('[E2EE][XFORM]', `receiver init-ready timeout (5s) kind=${kind} — worker may not have received init`);
    console.warn(`[E2EE][XFORM] receiver init-ready timeout (5s) for ${kind} — transform may not be active`);
  }, 5000);

  port1.addEventListener('message', e => {
    const { type } = e.data || {};
    if (type === 'ready') {
      clearTimeout(initTimer);
      log('[E2EE][XFORM]', `receiver init ack received kind=${kind}`);
      console.info(`[E2EE][XFORM] receiver init ack (ready) received kind=${kind} ✅`);
    } else if (type === 'log') {
      const { level, tag, msg } = e.data;
      if (level === 'error') logError(tag, msg);
      else if (level === 'warn') logWarn(tag, msg);
      else log(tag, msg);
    } else if (type === 'decrypt-ready') {
      log('[E2EE][XFORM]', `decrypt-ready kind=${kind}`);
    } else if (type === 'decrypt-error') {
      logError('[E2EE][XFORM]', `decrypt-error kind=${kind}:`, e.data.message);
    } else if (type === 'version-mismatch') {
      logError('[E2EE][XFORM]', `version-mismatch receiver kind=${kind} got=0x${e.data.version?.toString(16)}`);
    } else if (type === 'counter-exhausted') {
      logError('[E2EE][XFORM]', `counter-exhausted receiver kind=${kind}`);
    }
  });

  port1.postMessage({ type: 'init', debug, media: kind });
  log('[E2EE][XFORM]', `receiver transform attached trackId=${receiver.track.id} kind=${kind}`);
  console.info(`[E2EE][XFORM] receiver transform attached trackId=${receiver.track.id} kind=${kind}`);
  return { port: port1, kind, role: 'receiver' };
}

export async function pushKeyToPortRecord(pr: PortRecord, keys: DerivedKeys): Promise<void> {
  const mk = pr.role === 'sender' ? keys.send[pr.kind] : keys.recv[pr.kind];
  const msgType  = pr.role === 'sender' ? 'set-encrypt-key'  : 'set-decrypt-key';
  const ackType  = pr.role === 'sender' ? 'encrypt-ready'    : 'decrypt-ready';
  const epoch    = 0;
  const MAX_TRIES = 3;

  for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
    const keyData = await crypto.subtle.exportKey('raw', mk.key);

    const ackPromise = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        pr.port.removeEventListener('message', handler);
        reject(new Error(`${ackType} timeout attempt=${attempt}`));
      }, 2000);

      const handler = (e: MessageEvent) => {
        if (e.data?.type === ackType) {
          clearTimeout(timer);
          pr.port.removeEventListener('message', handler);
          resolve();
        }
      };
      pr.port.addEventListener('message', handler);
    });

    pr.port.postMessage({ type: msgType, keyData, ivSeed: mk.ivSeed, epoch }, [keyData]);
    log('[E2EE][KEY]', `pushKey attempt=${attempt} role=${pr.role} kind=${pr.kind} msgType=${msgType} epoch=${epoch}`);
    console.info(`[E2EE][KEY] ${msgType} direction=${pr.role} mediaKind=${pr.kind} epoch=${epoch} attempt=${attempt} ivSeed=${Array.from(mk.ivSeed).map(b => b.toString(16).padStart(2,'0')).join('')}`);

    try {
      await ackPromise;
      log('[E2EE][KEY]', `${ackType} confirmed role=${pr.role} kind=${pr.kind} attempt=${attempt}`);
      console.info(`[E2EE][KEY] ${ackType} confirmed ✅ role=${pr.role} kind=${pr.kind} attempt=${attempt}`);
      return;
    } catch (err) {
      if (attempt < MAX_TRIES) {
        logWarn('[E2EE][KEY]', `${String(err)} — retrying (${attempt}/${MAX_TRIES})`);
        console.warn(`[E2EE][KEY] ${String(err)} — retrying...`);
      } else {
        logError('[E2EE][KEY]', `key push failed after ${MAX_TRIES} attempts role=${pr.role} kind=${pr.kind}: ${err}`);
        console.error(`[E2EE][KEY] key push FAILED after ${MAX_TRIES} attempts role=${pr.role} kind=${pr.kind}`);
      }
    }
  }
}

// Suppress unused — E2EE_DEBUG is used transitively by callers
void E2EE_DEBUG;
