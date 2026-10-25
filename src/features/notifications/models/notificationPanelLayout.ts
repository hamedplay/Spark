export function notificationPanelLayout(viewportWidth: number, viewportHeight: number, trigger: { right: number; bottom: number }) {
  const margin = 8;
  const width = Math.max(1, Math.min(420, viewportWidth - margin * 2));
  const left = Math.max(margin, Math.min(trigger.right - width, viewportWidth - width - margin));
  const top = Math.max(margin, Math.min(trigger.bottom + margin, viewportHeight - 180));
  const maxHeight = Math.max(1, Math.min(520, viewportHeight * 0.62, viewportHeight - top - margin));
  return { width, left, top, maxHeight };
}
