import { mobileZoomDayCount } from './weekZoom';

const clockMinutes = (time: string | undefined) => {
  if (!time || !/^\d{2}:\d{2}/.test(time)) return null;
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
};

export function focusCalendarNow(
  mode: string, root: HTMLElement | null, time: HTMLElement | null,
  list: HTMLElement | null, now: Date, slotHeight: number, startHour = 0,
) {
  const minute = now.getHours() * 60 + now.getMinutes();
  if (mode === 'schedule' && list) {
    const today = list.querySelector<HTMLElement>('[data-today="true"]');
    if (!today) { list.scrollTop = 0; return; }
    const cards = Array.from(today.querySelectorAll<HTMLElement>('[data-calendar-meeting]'));
    const timed = cards.map(card => ({ card, start: clockMinutes(card.dataset.startTime), end: clockMinutes(card.dataset.endTime) }));
    const ongoing = timed.find(item => item.start !== null && item.start <= minute && item.end !== null && item.end > minute);
    const upcoming = timed.filter(item => item.start !== null && item.start >= minute)
      .sort((a, b) => a.start! - b.start!)[0];
    const target = ongoing?.card || upcoming?.card || cards.at(-1) || today;
    list.scrollTop = Math.max(0, list.scrollTop + target.getBoundingClientRect().top - list.getBoundingClientRect().top - 40);
    return;
  }
  const today = root?.querySelector<HTMLElement>('[data-calendar-today="true"]');
  today?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'auto' });
  if ((mode === 'day' || mobileZoomDayCount(mode) > 0 || mode === 'work-week') && time) {
    const header = time.querySelector<HTMLElement>('[data-week-header]')?.offsetHeight || 0;
    time.scrollTop = Math.max(0, (minute - startHour * 60) / 30 * slotHeight - (time.clientHeight - header) / 2);
  }
}
