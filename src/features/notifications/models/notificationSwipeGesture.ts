export interface NotificationSwipeDecision {
  dismiss: boolean;
  direction: -1 | 0 | 1;
  thresholdPx: number;
  velocityPxPerMs: number;
}

const MIN_DISTANCE_PX = 26;
const MIN_DISMISS_THRESHOLD_PX = 64;
const MAX_DISMISS_THRESHOLD_PX = 88;
const VIEWPORT_THRESHOLD_RATIO = 0.2;
const FLICK_VELOCITY_PX_PER_MS = 0.5;

export function getNotificationSwipeDecision(
  distanceX: number,
  durationMs: number,
  viewportWidth: number,
): NotificationSwipeDecision {
  const safeViewportWidth = Number.isFinite(viewportWidth) && viewportWidth > 0
    ? viewportWidth
    : 360;

  const thresholdPx = Math.min(
    MAX_DISMISS_THRESHOLD_PX,
    Math.max(
      MIN_DISMISS_THRESHOLD_PX,
      safeViewportWidth * VIEWPORT_THRESHOLD_RATIO,
    ),
  );

  const distance = Math.abs(distanceX);
  const safeDuration = Math.max(1, durationMs);
  const velocityPxPerMs = distance / safeDuration;
  const direction: -1 | 0 | 1 =
    distanceX > 0 ? 1 : distanceX < 0 ? -1 : 0;

  return {
    dismiss:
      distance >= thresholdPx ||
      (
        distance >= MIN_DISTANCE_PX &&
        velocityPxPerMs >= FLICK_VELOCITY_PX_PER_MS
      ),
    direction,
    thresholdPx,
    velocityPxPerMs,
  };
}
