/**
 * e2ee-worker.js  v3
 *
 * RTCRtpScriptTransform handler for per-frame AES-GCM-256 encryption.
 *
 * SECURITY PROPERTIES
 * ───────────────────
 * • Frames are DROPPED (not passed through) until a key is installed.
 *   Cleartext media never enters the transport layer.
 * • Separate AES-GCM-256 key per (direction × media-kind):
 *     caller-to-callee/audio, caller-to-callee/video,
 *     callee-to-caller/audio, callee-to-caller/video
 *   A captured receive/video key cannot be used to forge audio frames.
 * • IV/nonce (12 B) = [8 B per-direction seed ‖ 4 B monotonic counter BE].
 *   The seed changes on key rotation; the counter is never reset except
 *   on rotation — so IV(epoch, counter) is globally unique within a session.
 * • Frame header (6 B, prepended): [1 B version=0x02][1 B epoch][4 B counter BE]
 * • Counter exhaustion at 2^32 triggers a `counter-exhausted` notification.
 *
 * Init message (required before encrypt/decrypt keys):
 *   { type: 'init', debug: boolean, media: 'audio'|'video' }
 *
 * Main → Worker messages (via MessagePort transferred in options.port):
 *   { type:'set-encrypt-key',    keyData:ArrayBuffer, ivSeed:Uint8Array(8), epoch:number }
 *   { type:'set-decrypt-key',    keyData:ArrayBuffer, ivSeed:Uint8Array(8), epoch:number }
 *   { type:'rotate-encrypt-key', keyData:ArrayBuffer, ivSeed:Uint8Array(8), epoch:number }
 *   { type:'rotate-decrypt-key', keyData:ArrayBuffer, ivSeed:Uint8Array(8), epoch:number }
 *   { type:'clear' }
 *   { type:'ping' }
 *
 * Worker → Main:
 *   { type:'ready' }
 *   { type:'encrypt-ready' }  { type:'decrypt-ready' }
 *   { type:'counter-exhausted' }  { type:'pong' }
 *   { type:'encrypt-error', message:string }
 *   { type:'decrypt-error', message:string }
 *   { type:'version-mismatch', version:number }
 *   { type:'log', level:'info'|'warn'|'error', tag:string, msg:string }
 */

const FRAME_VERSION = 0x02;
const HEADER_LEN    = 6;       // 1 B version + 1 B epoch + 4 B counter
const GCM_TAG_LEN   = 16;
const IV_LEN        = 12;      // 8 B seed || 4 B counter
const MAX_COUNTER   = 0xFFFF_FFFF;

const DEBUG_LOGS = false;
function workerLog(msg) { if (DEBUG_LOGS) console.log('[E2EE-Worker]', msg); }

// ── Worker health check ────────────────────────────────────────────────────
workerLog('worker script loaded');

self.addEventListener('message', event => {
  const { type, testPort } = event.data || {};
  if (type === 'ping') {
    workerLog('ping received — sending pong');
    if (testPort) {
      testPort.postMessage({ type: 'pong' });
    } else {
      self.postMessage({ type: 'pong' });
    }
  }
});

self.addEventListener('rtctransform', event => {
  const { role, port } = event.transformer.options;

  // Resolved after 'init' message
  let debugEnabled = false;
  let mediaKind    = 'unknown'; // 'audio' | 'video'

  let encryptKey    = null, decryptKey    = null;
  let encryptIvSeed = null, decryptIvSeed = null;
  let encryptEpoch  = 0,    decryptEpoch  = 0;
  let frameCounter  = 0;
  let encryptReady  = false, decryptReady = false;
  let encryptDropCount = 0;
  let decryptDropCount = 0;
  let decryptErrorCount = 0;
  let counterExhaustedFired = false;

  const log = (level, tag, msg) => {
    if (!debugEnabled && level !== 'error') return;
    port.postMessage({ type: 'log', level, tag, msg });
  };

  /** Build the 12-byte AES-GCM nonce: 8B seed || 4B counter (big-endian). */
  const makeIV = (seed, counter) => {
    const iv = new Uint8Array(IV_LEN);
    iv.set(seed, 0);
    new DataView(iv.buffer).setUint32(8, counter >>> 0, false /* big-endian */);
    return iv;
  };

  port.addEventListener('message', async msg => {
    const { type, epoch } = msg.data;

    // Guard: transformer may be in a closed/invalid state after PC teardown
    if (!event.transformer) {
      log('warn', '[E2EE][WORKER]', 'transformer not available, ignoring message type=' + type);
      return;
    }

    if (type === 'init') {
      debugEnabled = !!msg.data.debug;
      mediaKind    = msg.data.media || 'unknown';
      log('info', '[E2EE][WORKER]', `init role=${role} media=${mediaKind} debug=${debugEnabled}`);
      port.postMessage({ type: 'ready' });
      return;
    }

    if (type === 'set-encrypt-key' || type === 'rotate-encrypt-key') {
      const requestId = msg.data.requestId ?? null;
      try {
        encryptKey = await crypto.subtle.importKey('raw', msg.data.keyData, { name: 'AES-GCM' }, false, ['encrypt']);
      } catch (err) {
        log('error', '[E2EE][WORKER]', `importKey (encrypt) failed: ${err}`);
        port.postMessage({ type: 'encrypt-error', message: String(err), requestId });
        return;
      }

      if (type === 'rotate-encrypt-key') {
        // Key rotation: always reset counter (new seed guarantees IV uniqueness)
        encryptIvSeed = new Uint8Array(msg.data.ivSeed);
        encryptEpoch  = msg.data.epoch ?? 0;
        frameCounter  = 0;
        encryptDropCount = 0;
        counterExhaustedFired = false;
        log('info', '[E2EE][WORKER]', `rotate-encrypt-key epoch=${encryptEpoch} media=${mediaKind}`);
      } else {
        // Initial key set: only reset counter when ivSeed actually changed
        // (avoids IV reuse on ICE restart where same key+seed is re-pushed)
        const newSeed = new Uint8Array(msg.data.ivSeed);
        const sameSeed = encryptIvSeed &&
          encryptIvSeed.length === newSeed.length &&
          encryptIvSeed.every((b, i) => b === newSeed[i]);
        encryptIvSeed = newSeed;
        encryptEpoch  = msg.data.epoch ?? 0;
        if (!sameSeed) { frameCounter = 0; counterExhaustedFired = false; }
        encryptDropCount = 0;
        log('info', '[E2EE][WORKER]', `set-encrypt-key epoch=${encryptEpoch} media=${mediaKind} counterReset=${!sameSeed}`);
      }

      encryptReady = true;
      if (type === 'set-encrypt-key') port.postMessage({ type: 'encrypt-ready', requestId });
      // generateKeyFrame() is video-only
      if (mediaKind === 'video') {
        try { event.transformer.generateKeyFrame(); } catch { /* optional API */ }
      }

    } else if (type === 'set-decrypt-key' || type === 'rotate-decrypt-key') {
      const requestId = msg.data.requestId ?? null;
      try {
        decryptKey = await crypto.subtle.importKey('raw', msg.data.keyData, { name: 'AES-GCM' }, false, ['decrypt']);
      } catch (err) {
        log('error', '[E2EE][WORKER]', `importKey (decrypt) failed: ${err}`);
        port.postMessage({ type: 'decrypt-error', message: String(err), requestId });
        return;
      }
      decryptIvSeed    = new Uint8Array(msg.data.ivSeed);
      decryptEpoch     = msg.data.epoch ?? 0;
      decryptDropCount = 0;
      if (type === 'rotate-decrypt-key') {
        log('info', '[E2EE][WORKER]', `rotate-decrypt-key epoch=${decryptEpoch} media=${mediaKind}`);
      } else {
        log('info', '[E2EE][WORKER]', `set-decrypt-key epoch=${decryptEpoch} media=${mediaKind}`);
      }
      decryptReady = true;
      if (type === 'set-decrypt-key') port.postMessage({ type: 'decrypt-ready', requestId });
      // sendKeyFrameRequest() is video-only
      if (mediaKind === 'video') {
        try { event.transformer.sendKeyFrameRequest(); } catch { /* optional */ }
      }

    } else if (type === 'clear') {
      // Called at call end — wipe all key material and reset state
      encryptKey    = null;
      decryptKey    = null;
      encryptIvSeed = null;
      decryptIvSeed = null;
      encryptEpoch  = 0;
      decryptEpoch  = 0;
      frameCounter  = 0;
      encryptReady  = false;
      decryptReady  = false;
      encryptDropCount = 0;
      decryptDropCount = 0;
      decryptErrorCount = 0;
      counterExhaustedFired = false;
      log('info', '[E2EE][WORKER]', `clear: state wiped media=${mediaKind}`);

    } else if (type === 'ping') {
      port.postMessage({ type: 'pong' });
    }
  });
  port.start();
  log('info', '[E2EE][WORKER]', `transform listener ready role=${role}`);

  // ── Sender ────────────────────────────────────────────────────────────────
  if (role === 'sender') {
    event.transformer.readable
      .pipeThrough(new TransformStream({
        async transform(frame, controller) {
          if (!encryptReady) {
            encryptDropCount++;
            if (encryptDropCount === 1 || encryptDropCount % 100 === 0) {
              log('warn', '[E2EE][WORKER]', `sender drop: encrypt not ready count=${encryptDropCount} media=${mediaKind}`);
            }
            // Drop — key not yet installed, never send cleartext
            return;
          }

          if (frameCounter > MAX_COUNTER) {
            if (!counterExhaustedFired) {
              counterExhaustedFired = true;
              port.postMessage({ type: 'counter-exhausted' });
              log('error', '[E2EE][WORKER]', `counter exhausted media=${mediaKind}`);
            }
            return;
          }

          const counter = frameCounter++;
          const iv = makeIV(encryptIvSeed, counter);

          const raw = (frame.data instanceof ArrayBuffer)
            ? frame.data
            : frame.data.buffer.slice(
                frame.data.byteOffset,
                frame.data.byteOffset + frame.data.byteLength,
              );

          try {
            const ct  = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, encryptKey, raw);
            const out = new Uint8Array(HEADER_LEN + ct.byteLength);
            const hdr = new DataView(out.buffer);
            hdr.setUint8(0, FRAME_VERSION);
            hdr.setUint8(1, encryptEpoch & 0xFF);
            hdr.setUint32(2, counter >>> 0, false); // big-endian
            out.set(new Uint8Array(ct), HEADER_LEN);
            frame.data = out.buffer;
            try { controller.enqueue(frame); } catch { /* stream closed during PC teardown */ }
          } catch (err) {
            port.postMessage({ type: 'encrypt-error', message: String(err) });
            log('error', '[E2EE][WORKER]', `encrypt failed media=${mediaKind}: ${err}`);
            // drop frame — do not fall back to cleartext
          }
        },
      }))
      .pipeTo(event.transformer.writable)
      .catch(err => {
        if (err && err.name !== 'AbortError') {
          log('warn', '[E2EE][WORKER]', `sender pipeline ended role=${role} media=${mediaKind}: ${err}`);
        }
      });

  // ── Receiver ──────────────────────────────────────────────────────────────
  } else {
    event.transformer.readable
      .pipeThrough(new TransformStream({
        async transform(frame, controller) {
          if (!decryptReady) {
            decryptDropCount++;
            if (decryptDropCount === 1 || decryptDropCount % 100 === 0) {
              log('info', '[E2EE][WORKER]', `frame dropped: no decrypt key yet media=${mediaKind}`);
            }
            if (mediaKind === 'video') {
              try { event.transformer.sendKeyFrameRequest(); } catch { /* optional */ }
            }
            return;
          }

          const raw = (frame.data instanceof ArrayBuffer)
            ? new Uint8Array(frame.data)
            : new Uint8Array(
                frame.data.buffer,
                frame.data.byteOffset,
                frame.data.byteLength,
              );

          // Minimum length: header + at least 1 plaintext byte + GCM tag
          if (raw.length < HEADER_LEN + GCM_TAG_LEN + 1) {
            log('warn', '[E2EE][WORKER]', `frame too short len=${raw.length} media=${mediaKind}`);
            return;
          }

          if (raw[0] !== FRAME_VERSION) {
            port.postMessage({ type: 'version-mismatch', version: raw[0] });
            log('warn', '[E2EE][WORKER]', `version mismatch got=${raw[0]} expected=${FRAME_VERSION} media=${mediaKind}`);
            return;
          }

          const frameEpoch = raw[1];
          if (frameEpoch !== (decryptEpoch & 0xFF)) {
            log('warn', '[E2EE][WORKER]', `epoch mismatch frame=${frameEpoch} local=${decryptEpoch} media=${mediaKind}`);
            // still try to decrypt — epoch can be ahead during rotation
          }

          const counter = new DataView(raw.buffer, raw.byteOffset).getUint32(2, false);
          const iv      = makeIV(decryptIvSeed, counter);
          const ct      = raw.slice(HEADER_LEN);

          try {
            const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, decryptKey, ct);
            frame.data = pt;
            try { controller.enqueue(frame); } catch { /* stream closed during PC teardown */ }
          } catch (err) {
            decryptErrorCount++;
            log('warn', '[E2EE][WORKER]', `decrypt failed media=${mediaKind} counter=${counter}: ${err}`);
            port.postMessage({ type: 'decrypt-error', message: `${mediaKind} counter=${counter}: ${err}` });
            if (mediaKind === 'video') {
              try { event.transformer.sendKeyFrameRequest(); } catch { /* optional */ }
            }
          }
        },
      }))
      .pipeTo(event.transformer.writable)
      .catch(err => {
        if (err && err.name !== 'AbortError') {
          log('warn', '[E2EE][WORKER]', `receiver pipeline ended role=${role} media=${mediaKind}: ${err}`);
        }
      });
  }
});

self.addEventListener('error', evt => {
  workerLog(`unhandled error: ${evt.message} ${evt.filename}:${evt.lineno}`);
});
