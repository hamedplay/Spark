export const MAX_PARTICIPANTS = 20;

export function calculateBitrate(width: number, height: number, fps: number) {
  const pixels = width * height;
  const factor = fps / 30;
  const base = pixels * 0.07 * factor;
  return { min: Math.floor(base * 0.5), max: Math.floor(base * 1.5) };
}

export async function setPreferredCodecs(pc: RTCPeerConnection) {
  if (!RTCRtpSender.getCapabilities) return;
  const capabilities = RTCRtpSender.getCapabilities('video');
  if (!capabilities) return;
  const preferredMimes = ['video/VP9', 'video/H264', 'video/VP8'];
  const ordered: RTCRtpCodecCapability[] = [];
  for (const mime of preferredMimes) {
    const found = capabilities.codecs.filter(c => c.mimeType.toLowerCase() === mime.toLowerCase());
    ordered.push(...found);
  }
  capabilities.codecs.forEach(c => {
    if (!ordered.find(oc => oc.mimeType === c.mimeType && oc.sdpFmtpLine === c.sdpFmtpLine)) {
      ordered.push(c);
    }
  });
  for (const transceiver of pc.getTransceivers()) {
    if (transceiver.sender.track?.kind === 'video') {
      try { transceiver.setCodecPreferences(ordered); } catch { /* not supported in all browsers */ }
    }
  }
}

export const EMOJIS = ['👍','👏','❤️','😂','😮','🎉','🙌','🔥','💯','✅'];
