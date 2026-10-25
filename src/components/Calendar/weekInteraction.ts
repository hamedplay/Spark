export function weekDayIndex(x: number, grid: { right: number; width: number }, count = 7) {
  if (grid.width <= 0 || count <= 0) return 0;
  return Math.max(0, Math.min(count - 1, Math.floor((grid.right - x) / (grid.width / count))));
}

// Insets are percentages of the containing day, unlike translateX percentages
// which are relative to the (possibly overlapping and narrower) meeting card.
export function weekDragInsets(deltaDay: number, leftPct: number, widthPct: number, gutter = 2) {
  return {
    right: `calc(${leftPct + deltaDay * 100}% + ${gutter}px)`,
    left: `calc(${100 - leftPct - widthPct - deltaDay * 100}% + ${gutter}px)`,
  };
}
