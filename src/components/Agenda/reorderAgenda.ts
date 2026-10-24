/** Move without mutating records, IDs, linked decisions, or the source array. */
export function moveAgendaItem<T>(items: readonly T[], from: number, to: number): T[] {
  if (!Number.isInteger(from) || !Number.isInteger(to)
    || from < 0 || to < 0 || from >= items.length || to >= items.length) {
    return [...items];
  }
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export function reorderMeetingAgenda<T extends { sort_order: number }>(items: readonly T[], from: number, to: number): T[] {
  return moveAgendaItem(items, from, to).map((item, index) => ({ ...item, sort_order: index }));
}

export function reorderMinutesAgenda<T extends { order: number }>(items: readonly T[], from: number, to: number): T[] {
  return moveAgendaItem(items, from, to).map((item, index) => ({ ...item, order: index + 1 }));
}
