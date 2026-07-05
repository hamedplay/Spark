/**
 * e2ee-worker.js  v2
 *
 * RTCRtpScriptTransform handler for per-frame AES-GCM-256 encryption.
 *
 * SECURITY PROPERTIES
 * ───────────────────
 * • Frames are DROPPED (not passed through) until a key is installed.
 *   Cleartext media never enters the transport layer.
 * • Sender and receiver hold SEPARATE CryptoKey objects:
 *     sender → encrypt-only key
 *     receiver → decrypt-only key
 *   Both are derived from the ECDH shared secret via HKDF with direction-aware
 *   info strings, so a captured receive key cannot be used to forge frames.
 * • IV/nonce (12 B) = [8 B per-direction seed ‖ 4 B monotonic counter BE].
 *   The seed is derived via HKDF and changes on key rotation; the counter is
 *   never reset except on rotation — so IV(epoch, counter) is globally unique
 *   within a session.
 * • Frame header (6 B, prepended): [1 B version=0x01] [1 B epoch] [4 B counter BE]
 *   — versioned for future SFrameTransform / cipher migrations.
 * • Counter exhaustion at 2^32 triggers a `counter-exhausted` notification to
 *   the main thread, which should rotate keys before the counter overflows.
 *
 * Main → Worker messages (via MessagePort transferred in options.port):
 *   { type:'set-encrypt-key',    key:CryptoKey, ivSeed:Uint8Array(8), epoch:number }
 *   { type:'set-decrypt-key',    key:CryptoKey, ivSeed:Uint8Array(8), epoch:number }
 *   { type:'rotate-encrypt-key', key, ivSeed, epoch }  ← resets frame counter to 0
 *   { type:'rotate-decrypt-key', key, ivSeed, epoch }
 *   { type:'ping' }
 *
 * Worker → Main:
 *   { type:'encrypt-ready' }  { type:'decrypt-ready' }
 *   { type:'counter-exhausted' }  { type:'pong' }
 *   { type:'encrypt-error', message:string }
 *   { type:'version-mismatch', version:number }
 *
 * SFrameTransform migration path:
 *   Replace the TransformStream bodies with an SFrameTransform instance once
 *   the standard ships broadly — key derivation, HKDF context strings, and the
 *   signalling layer remain unchanged.
 */

const FRAME_VERSION = 0x01;
const HEADER_LEN    = 6;       // 1 B version + 1 B epoch + 4 B counter
const GCM_TAG_LEN   = 16;
const IV_LEN        = 12;      // 8 B seed || 4 B counter
const MAX_COUNTER   = 0xFFFF_FFFF;

self.addEventListener('rtctransform', event => {
  const { role, port } = event.transformer.options;

  let encryptKey    = null, decryptKey    = null;
  let encryptIvSeed = null, decryptIvSeed = null;
  let encryptEpoch  = 0,    decryptEpoch  = 0;
  let frameCounter  = 0;
  let encryptReady  = false, decryptReady = false;

  /** Build the 12-byte AES-GCM nonce from the direction seed and frame counter. */
  const makeIV = (seed, counter) => {
    const iv = new Uint8Array(IV_LEN);
    iv.set(seed, 0);
    new DataView(iv.buffer).setUint32(8, counter, /* big-endian */ false);
    return iv;
  };

  port.addEventListener('message', msg => {
    const { type } = msg.data;

    if (type === 'set-encrypt-key' || type === 'rotate-encrypt-key') {
      encryptKey    = msg.data.key;
      encryptIvSeed = new Uint8Array(msg.data.ivSeed); // defensive copy
      encryptEpoch  = msg.data.epoch ?? 0;
      if (type === 'rotate-encrypt-key') frameCounter = 0; // counter resets on rotation
      encryptReady  = true;
      if (type === 'set-encrypt-key') port.postMessage({ type: 'encrypt-ready' });
      try { event.transformer.generateKeyFrame(); } catch { /* optional API */ }

    } else if (type === 'set-decrypt-key' || type === 'rotate-decrypt-key') {
      decryptKey    = msg.data.key;
      decryptIvSeed = new Uint8Array(msg.data.ivSeed);
      decryptEpoch  = msg.data.epoch ?? 0;
      decryptReady  = true;
      if (type === 'set-decrypt-key') port.postMessage({ type: 'decrypt-ready' });
      try { event.transformer.sendKeyFrameRequest(); } catch { /* optional API */ }

    } else if (type === 'ping') {
      port.postMessage({ type: 'pong' });
    }
  });
  port.start();

  // ── Sender ────────────────────────────────────────────────────────────────
  if (role === 'sender') {
    event.transformer.readable
      .pipeThrough(new TransformStream({
        async transform(frame, controller) {
          // Drop frame until encrypt key is installed — never send cleartext.
          if (!encryptReady) return;

          if (frameCounter > MAX_COUNTER) {
            port.postMessage({ type: 'counter-exhausted' });
            return; // drop — key rotation required before sending more frames
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
            hdr.setUint8(1, encryptEpoch);
            hdr.setUint32(2, counter, false); // big-endian
            out.set(new Uint8Array(ct), HEADER_LEN);
            frame.data = out.buffer;
            controller.enqueue(frame);
          } catch (err) {
            port.postMessage({ type: 'encrypt-error', message: String(err) });
            // drop frame — do not fall back to cleartext
          }
        },
      }))
      .pipeTo(event.transformer.writable);

  // ── Receiver ──────────────────────────────────────────────────────────────
  } else {
    event.transformer.readable
      .pipeThrough(new TransformStream({
        async transform(frame, controller) {
          // Drop frame until decrypt key is installed.
          if (!decryptReady) {
            try { event.transformer.sendKeyFrameRequest(); } catch { /* optional */ }
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
          if (raw.length < HEADER_LEN + GCM_TAG_LEN + 1) return;

          if (raw[0] !== FRAME_VERSION) {
            port.postMessage({ type: 'version-mismatch', version: raw[0] });
            return; // unknown format — drop
          }

          const counter = new DataView(raw.buffer, raw.byteOffset).getUint32(2, false);
          const iv      = makeIV(decryptIvSeed, counter);
          const ct      = raw.slice(HEADER_LEN);

          try {
            const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, decryptKey, ct);
            frame.data = pt;
            controller.enqueue(frame);
          } catch {
            // AES-GCM authentication failure: wrong key, corrupted frame,
            // out-of-epoch frame, or partial replay. Drop and ask for keyframe.
            try { event.transformer.sendKeyFrameRequest(); } catch { /* optional */ }
          }
        },
      }))
      .pipeTo(event.transformer.writable);
  }
});

// Surface any unhandled worker errors to the console.
self.addEventListener('error', evt => {
  console.error('[e2ee-worker] unhandled error:', evt.message, evt.filename, evt.lineno);
});
