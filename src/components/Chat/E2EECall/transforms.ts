import { SUPPORTS_TRANSFORMS, log, logWarn, logError } from './types';
import type { DerivedKeys, TransformState } from './types';
import { v4 as uuidv4 } from 'uuid';

export interface PortRecord {
  id:                 string;
  port:               MessagePort;
  kind:               'audio' | 'video';
  role:               'sender' | 'receiver';
  state:              TransformState;
  installedEpoch:     number | null;
  // Resolves when the worker has replied 'ready' to our 'init' message.
  // Must be awaited before sending key material.
  workerReadyPromise: Promise<void>;
}

// WeakMap dedup — one transform per sender/receiver
const senderTransformMap  = new WeakMap<RTCRtpSender,   PortRecord>();
const receiverTransformMap = new WeakMap<RTCRtpReceiver, PortRecord>();

export function ensureWorkerReady(worker: Worker): Promise<void> {
  return new Promise((resolve, reject) => {
    const { port1: testPort1, port2: testPort2 } = new MessageChannel();
    testPort1.start();
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        testPort1.close();
        logWarn('[E2EE][WORKER]', 'ping timeout — worker not responding');
        reject(new Error('worker ping timeout'));
      }
    }, 3000);

    testPort1.addEventListener('message', (e: MessageEvent) => {
      if (!settled && e.data?.type === 'pong') {
        settled = true;
        clearTimeout(timer);
        testPort1.close();
        log('[E2EE][WORKER]', 'worker health check passed (pong received)');
        resolve();
      }
    });

    worker.postMessage({ type: 'ping', testPort: testPort2 }, [testPort2]);
    log('[E2EE][WORKER]', 'sending ping to worker via test port');
  });
}

function makeWorkerReadyPromise(port: MessagePort, kind: string, role: string): Promise<void> {
  let settle!: (state: 'worker-ready' | 'failed') => void;
  const promise = new Promise<void>((resolve, reject) => {
    settle = (s) => { if (s === 'worker-ready') resolve(); else reject(new Error('worker init failed')); };
  });

  const initTimer = setTimeout(() => {
    logWarn('[E2EE][XFORM]', `${role} init-ready timeout (5s) kind=${kind} — worker may not have received init`);
    settle('failed');
  }, 5000);

  const handler = (e: MessageEvent) => {
    const { type } = e.data || {};
    if (type === 'ready') {
      clearTimeout(initTimer);
      port.removeEventListener('message', handler);
      log('[E2EE][XFORM]', `${role} init ack received kind=${kind}`);
      settle('worker-ready');
    }
  };
  port.addEventListener('message', handler);

  return promise;
}

export function attachSenderTransform(
  sender: RTCRtpSender,
  worker: Worker,
  debug: boolean,
): PortRecord | null {
  if (!SUPPORTS_TRANSFORMS || !sender.track) return null;

  // Dedup — never attach twice to the same sender
  const existing = senderTransformMap.get(sender);
  if (existing && existing.state !== 'closed' && existing.state !== 'failed') {
    log('[E2EE][XFORM]', `sender already has transform kind=${existing.kind} — reusing`);
    return existing;
  }

  const kind = sender.track.kind as 'audio' | 'video';
  if (kind !== 'audio' && kind !== 'video') {
    logWarn('[E2EE][XFORM]', `unknown sender track kind=${sender.track.kind} — skipping`);
    return null;
  }

  const { port1, port2 } = new MessageChannel();
  sender.transform = new RTCRtpScriptTransform(worker, { role: 'sender', port: port2 }, [port2]);
  port1.start();

  const workerReadyPromise = makeWorkerReadyPromise(port1, kind, 'sender');

  const pr: PortRecord = {
    id: uuidv4(),
    port: port1,
    kind,
    role: 'sender',
    state: 'created',
    installedEpoch: null,
    workerReadyPromise,
  };

  workerReadyPromise
    .then(() => { if (pr.state === 'created') pr.state = 'worker-ready'; })
    .catch(() => { pr.state = 'failed'; });

  port1.addEventListener('message', e => {
    const { type } = e.data || {};
    if (type === 'ready') {
      // handled by makeWorkerReadyPromise handler
    } else if (type === 'log') {
      const { level, tag, msg } = e.data;
      if (level === 'error') logError(tag, msg);
      else if (level === 'warn') logWarn(tag, msg);
      else log(tag, msg);
    } else if (type === 'encrypt-error') {
      logError('[E2EE][XFORM]', `encrypt-error kind=${kind}:`, e.data.message);
    } else if (type === 'version-mismatch') {
      logError('[E2EE][XFORM]', `version-mismatch sender kind=${kind} got=0x${e.data.version?.toString(16)}`);
    } else if (type === 'counter-exhausted') {
      logError('[E2EE][XFORM]', `counter-exhausted sender kind=${kind}`);
    }
  });

  port1.postMessage({ type: 'init', debug, media: kind });
  log('[E2EE][XFORM]', `sender transform attached trackId=${sender.track.id} kind=${kind} id=${pr.id}`);

  senderTransformMap.set(sender, pr);
  return pr;
}

export function attachReceiverTransform(
  receiver: RTCRtpReceiver,
  worker: Worker,
  debug: boolean,
): PortRecord | null {
  if (!SUPPORTS_TRANSFORMS || !receiver.track) return null;

  // Dedup — never attach twice to the same receiver
  const existing = receiverTransformMap.get(receiver);
  if (existing && existing.state !== 'closed' && existing.state !== 'failed') {
    log('[E2EE][XFORM]', `receiver already has transform kind=${existing.kind} — reusing`);
    return existing;
  }

  const kind = receiver.track.kind as 'audio' | 'video';
  if (kind !== 'audio' && kind !== 'video') {
    logWarn('[E2EE][XFORM]', `unknown receiver track kind=${receiver.track.kind} — skipping`);
    return null;
  }

  const { port1, port2 } = new MessageChannel();
  receiver.transform = new RTCRtpScriptTransform(worker, { role: 'receiver', port: port2 }, [port2]);
  port1.start();

  const workerReadyPromise = makeWorkerReadyPromise(port1, kind, 'receiver');

  const pr: PortRecord = {
    id: uuidv4(),
    port: port1,
    kind,
    role: 'receiver',
    state: 'created',
    installedEpoch: null,
    workerReadyPromise,
  };

  workerReadyPromise
    .then(() => { if (pr.state === 'created') pr.state = 'worker-ready'; })
    .catch(() => { pr.state = 'failed'; });

  port1.addEventListener('message', e => {
    const { type } = e.data || {};
    if (type === 'ready') {
      // handled by makeWorkerReadyPromise handler
    } else if (type === 'log') {
      const { level, tag, msg } = e.data;
      if (level === 'error') logError(tag, msg);
      else if (level === 'warn') logWarn(tag, msg);
      else log(tag, msg);
    } else if (type === 'decrypt-error') {
      logError('[E2EE][XFORM]', `decrypt-error kind=${kind}:`, e.data.message);
    } else if (type === 'version-mismatch') {
      logError('[E2EE][XFORM]', `version-mismatch receiver kind=${kind} got=0x${e.data.version?.toString(16)}`);
    } else if (type === 'counter-exhausted') {
      logError('[E2EE][XFORM]', `counter-exhausted receiver kind=${kind}`);
    }
  });

  port1.postMessage({ type: 'init', debug, media: kind });
  log('[E2EE][XFORM]', `receiver transform attached trackId=${receiver.track.id} kind=${kind} id=${pr.id}`);

  receiverTransformMap.set(receiver, pr);
  return pr;
}

export async function pushKeyToPortRecord(pr: PortRecord, keys: DerivedKeys): Promise<void> {
  const mk = pr.role === 'sender' ? keys.send[pr.kind] : keys.recv[pr.kind];
  const msgType = pr.role === 'sender' ? 'set-encrypt-key' : 'set-decrypt-key';
  const ackType = pr.role === 'sender' ? 'encrypt-ready'   : 'decrypt-ready';
  const epoch   = 0;
  const MAX_TRIES = 3;

  // Wait for worker to be ready before sending key material
  try {
    await pr.workerReadyPromise;
  } catch {
    pr.state = 'failed';
    throw new Error(`worker not ready for role=${pr.role} kind=${pr.kind}`);
  }

  for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
    const requestId = uuidv4();
    const keyData = await crypto.subtle.exportKey('raw', mk.key);

    pr.state = 'key-pending';

    const ackPromise = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        pr.port.removeEventListener('message', handler);
        reject(new Error(`${ackType} timeout attempt=${attempt} requestId=${requestId}`));
      }, 2000);

      const handler = (e: MessageEvent) => {
        if (e.data?.type === ackType && e.data?.requestId === requestId) {
          clearTimeout(timer);
          pr.port.removeEventListener('message', handler);
          resolve();
        }
      };
      pr.port.addEventListener('message', handler);
    });

    pr.port.postMessage({ type: msgType, keyData, ivSeed: mk.ivSeed, epoch, requestId }, [keyData]);
    log('[E2EE][KEY]', `pushKey attempt=${attempt} role=${pr.role} kind=${pr.kind} requestId=${requestId}`);

    try {
      await ackPromise;
      pr.state = 'key-ready';
      pr.installedEpoch = epoch;
      log('[E2EE][KEY]', `${ackType} confirmed role=${pr.role} kind=${pr.kind} attempt=${attempt}`);
      return;
    } catch (err) {
      logWarn('[E2EE][KEY]', `${String(err)} — retrying (${attempt}/${MAX_TRIES})`);
    }
  }

  pr.state = 'failed';
  logError('[E2EE][KEY]', `key push permanently failed role=${pr.role} kind=${pr.kind}`);
  throw new Error(`pushKey failed after ${MAX_TRIES} attempts role=${pr.role} kind=${pr.kind}`);
}
