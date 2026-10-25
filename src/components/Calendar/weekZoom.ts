export const WEEK_ZOOM_MAX = 8;
export const clampWeekZoom = (zoom: number) => Math.max(1, Math.min(WEEK_ZOOM_MAX, zoom));
export const weekZoomHeight = (ratio: number, slotHeight: number, minimum = 20) => Math.max(minimum, Math.min(120, slotHeight * Math.sqrt(ratio)));
export const weekZoomPixels = (value: number, enabled?: boolean) => enabled
  ? `calc(${value}px * var(--calendar-week-y, 1))`
  : `${value}px`;

export function fitWeekSlotHeight(height: number, startMinute: number, endMinute: number) {
  if (height <= 0 || endMinute <= startMinute) return null;
  return Math.max(4, Math.min(120, height / ((endMinute - startMinute) / 30)));
}

export const mobileZoomDayCount = (mode: string) => mode === 'week' ? 7 : mode === '3-day' ? 3 : mode === '4-day' ? 4 : 0;
