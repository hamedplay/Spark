export function notificationRowGesture(dx: number, dy: number) {
  if (Math.max(Math.abs(dx), Math.abs(dy)) < 10) return 'pending';
  return Math.abs(dx) > Math.abs(dy) * 1.3 ? 'horizontal' : 'vertical';
}

// Physical screen directions deliberately do not depend on the RTL page.
export function notificationRowAction(dx: number, read: boolean) {
  if (dx <= -72) return 'delete';
  if (dx >= 72 && !read) return 'read';
  return null;
}
