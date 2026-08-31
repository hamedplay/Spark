import { DisconnectReason } from 'livekit-client';

export const LIVEKIT_FRESH_TOKEN_RECONNECT_DELAYS_MS = [
  1_000,
  3_000,
  5_000,
] as const;

export function shouldRetryWithFreshLiveKitToken(
  reason?: DisconnectReason,
): boolean {
  switch (reason) {
    case undefined:
    case DisconnectReason.UNKNOWN_REASON:
    case DisconnectReason.SERVER_SHUTDOWN:
    case DisconnectReason.STATE_MISMATCH:
    case DisconnectReason.JOIN_FAILURE:
    case DisconnectReason.MIGRATION:
    case DisconnectReason.SIGNAL_CLOSE:
    case DisconnectReason.CONNECTION_TIMEOUT:
    case DisconnectReason.MEDIA_FAILURE:
      return true;

    case DisconnectReason.CLIENT_INITIATED:
    case DisconnectReason.DUPLICATE_IDENTITY:
    case DisconnectReason.PARTICIPANT_REMOVED:
    case DisconnectReason.ROOM_DELETED:
    case DisconnectReason.ROOM_CLOSED:
    case DisconnectReason.USER_UNAVAILABLE:
    case DisconnectReason.USER_REJECTED:
    case DisconnectReason.SIP_TRUNK_FAILURE:
    default:
      return false;
  }
}

export function liveKitTerminalDisconnectLabel(
  reason?: DisconnectReason,
): string {
  switch (reason) {
    case DisconnectReason.PARTICIPANT_REMOVED:
      return 'دسترسی رسانه‌ای شما توسط مدیر جلسه قطع شد.';
    case DisconnectReason.DUPLICATE_IDENTITY:
      return 'این حساب از یک اتصال دیگر وارد همین جلسه شده است.';
    case DisconnectReason.ROOM_DELETED:
    case DisconnectReason.ROOM_CLOSED:
      return 'جلسه رسانه‌ای پایان یافته است.';
    default:
      return 'اتصال رسانه‌ای قطع شد و بازیابی خودکار امکان‌پذیر نیست.';
  }
}
