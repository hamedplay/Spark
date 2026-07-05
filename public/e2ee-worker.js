/**
 * E2EE Transform Worker — RTCRtpScriptTransform handler
 *
 * Receives an `rtctransform` event for each sender/receiver track.
 * Options shape: { role: 'sender' | 'receiver', port: MessagePort }
 *
 * The main thread sends the derived AES-GCM CryptoKey via the MessagePort.
 * Frame layout (sender output):
 *   [ IV (12 bytes) ][ AES-GCM ciphertext + 16-byte tag ]
 *
 * Future SFrameTransform drop-in: replace the TransformStream logic with
 * an SFrameTransform instance once the standard is finalised in browsers.
 */

self.addEventListener('rtctransform', (event) => {
  const { role, port } = event.transformer.options;

  // Shared key slot — written once ECDH derivation completes on main thread.
  let aesKey = null;
  // Track whether the receiver has ever had a key so we can request a keyframe.
  let keyEverSet = false;

  port.addEventListener('message', async (msg) => {
    const { type } = msg.data;

    if (type === 'set-key') {
      aesKey = msg.data.key; // CryptoKey (AES-GCM, extractable:false)
      port.postMessage({ type: 'key-ack', role });

      if (role === 'receiver' && !keyEverSet) {
        // Ask the sender for a fresh keyframe so the receiver can decode immediately.
        try { event.transformer.sendKeyFrameRequest(); } catch { /* optional API */ }
      }
      keyEverSet = true;
    }

    if (type === 'rotate-key') {
      aesKey = msg.data.key;
      port.postMessage({ type: 'rotate-ack', role });
      if (role === 'sender') {
        try { event.transformer.generateKeyFrame(); } catch { /* optional API */ }
      }
    }

    if (type === 'ping') {
      port.postMessage({ type: 'pong', role });
    }
  });
  port.start();

  if (role === 'sender') {
    const transform = new TransformStream({
      async transform(frame, controller) {
        if (!aesKey) {
          // No key yet — pass through unencrypted until key exchange completes.
          controller.enqueue(frame);
          return;
        }
        try {
          const iv = crypto.getRandomValues(new Uint8Array(12));
          const plaintext = frame.data instanceof ArrayBuffer
            ? frame.data
            : frame.data.buffer.slice(frame.data.byteOffset, frame.data.byteOffset + frame.data.byteLength);

          const ciphertext = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv },
            aesKey,
            plaintext,
          );

          // Prepend 12-byte IV.
          const out = new Uint8Array(12 + ciphertext.byteLength);
          out.set(iv, 0);
          out.set(new Uint8Array(ciphertext), 12);
          frame.data = out.buffer;
          controller.enqueue(frame);
        } catch {
          // On unexpected encrypt failure, drop the frame rather than leaking plaintext.
        }
      },
    });

    event.transformer.readable
      .pipeThrough(transform)
      .pipeTo(event.transformer.writable);

  } else {
    // receiver
    const transform = new TransformStream({
      async transform(frame, controller) {
        if (!aesKey) {
          // Key not yet available — request a keyframe and drop this frame.
          try { event.transformer.sendKeyFrameRequest(); } catch { /* optional API */ }
          return;
        }
        try {
          const data = frame.data instanceof ArrayBuffer
            ? new Uint8Array(frame.data)
            : new Uint8Array(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength);

          if (data.length < 13) {
            // Frame too short to contain IV + at least 1 encrypted byte.
            return;
          }

          const iv = data.slice(0, 12);
          const ciphertext = data.slice(12);

          const plaintext = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv },
            aesKey,
            ciphertext,
          );

          frame.data = plaintext;
          controller.enqueue(frame);
        } catch {
          // Decryption failure (bad tag, wrong key, non-encrypted frame in transit).
          // Request a keyframe from sender so the stream can recover.
          try { event.transformer.sendKeyFrameRequest(); } catch { /* optional API */ }
        }
      },
    });

    event.transformer.readable
      .pipeThrough(transform)
      .pipeTo(event.transformer.writable);
  }
});
