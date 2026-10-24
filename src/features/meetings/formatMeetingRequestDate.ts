import { formatJalaliDateForDisplay, formatJalaliTimestampDateOnly } from '../../lib/minutesDate';

/** Missing dates must never be interpreted as the Unix epoch. */
export function formatMeetingRequestDate(
  requestDate: string | null | undefined,
  storedJalaliDate?: string | null,
): string {
  const stored = formatJalaliDateForDisplay(storedJalaliDate);
  return stored !== '—' ? stored : formatJalaliTimestampDateOnly(requestDate);
}
