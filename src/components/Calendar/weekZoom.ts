export const WEEK_ZOOM_MAX = 8;
export const clampWeekZoom = (zoom: number) => Math.max(1, Math.min(WEEK_ZOOM_MAX, zoom));
export const weekZoomHeight = (ratio: number, slotHeight: number) => Math.max(20, Math.min(120, slotHeight * Math.sqrt(ratio)));
export const weekZoomPixels = (value: number, enabled?: boolean) => enabled
  ? `calc(${value}px * var(--calendar-week-y, 1))`
  : `${value}px`;
