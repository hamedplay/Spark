interface CalendarEventInput {
  title: string;
  date: string | null;
  startTime: string | null;
  endTime: string | null;
  location: string;
  details: string;
}

function tehranTime(date: string | null, time: string | null): Date {
  const match = /^(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/.exec(time || '');
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !match
    || Number(match[1]) > 23 || Number(match[2]) > 59 || Number(match[3] || 0) > 59) {
    throw new Error('INVALID_MEETING_TIME');
  }
  const day = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== date) throw new Error('INVALID_MEETING_TIME');
  // Calendar dates and wall-clock times use Tehran (+03:30), independent of the browser timezone.
  return new Date(`${date}T${match[1]}:${match[2]}:${match[3] || '00'}+03:30`);
}

export function buildCalendarGoogleEventUrl(input: CalendarEventInput): string {
  const start = tehranTime(input.date, input.startTime);
  const end = tehranTime(input.date, input.endTime);
  if (end.getTime() === start.getTime()) throw new Error('INVALID_MEETING_TIME');
  if (end < start) end.setUTCDate(end.getUTCDate() + 1);
  const compact = (date: Date) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const params = new URLSearchParams({
    action: 'TEMPLATE', text: input.title, dates: `${compact(start)}/${compact(end)}`,
    stz: 'Asia/Tehran', etz: 'Asia/Tehran', ctz: 'Asia/Tehran',
    details: input.details, location: input.location,
  });
  return `https://calendar.google.com/calendar/r/eventedit?${params}`;
}

type ExportWindow = Pick<Window, 'opener' | 'closed' | 'close'> & { location: Pick<Location, 'replace'> };

/** Reserve the tab during the click, before waiting for the agenda query. */
export async function openGoogleCalendarWindow(
  loadUrl: () => Promise<string>,
  openWindow: () => ExportWindow | null = () => window.open('about:blank', '_blank'),
): Promise<void> {
  const tab = openWindow();
  if (!tab) throw new Error('GOOGLE_CALENDAR_POPUP_BLOCKED');
  try {
    tab.opener = null;
    const url = await loadUrl();
    if (!tab.closed) tab.location.replace(url);
  } catch (error) {
    if (!tab.closed) tab.close();
    throw error;
  }
}
