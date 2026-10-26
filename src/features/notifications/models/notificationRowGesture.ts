export function notificationRowGesture(dx: number, dy: number) {
  if (Math.max(Math.abs(dx), Math.abs(dy)) < 10) return 'pending';
  if (Math.abs(dx) > Math.abs(dy) * 1.3) return 'horizontal';
  if (Math.abs(dy) > Math.abs(dx) * 1.3) return 'vertical';
  return 'pending';
}

// Physical screen directions deliberately do not depend on the RTL page.
export function notificationRowAction(dx: number, read: boolean) {
  if (dx <= -72) return 'delete';
  if (dx >= 72 && !read) return 'read';
  return null;
}
