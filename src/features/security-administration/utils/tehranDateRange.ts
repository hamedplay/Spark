export interface UtcDateRange {
  startUtc: string;
  endUtc: string;
}

const TEHRAN_TZ = 'Asia/Tehran';
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function isValidYMD(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || year < 1 || year > 9999) return false;
  if (!Number.isInteger(month) || month < 1 || month > 12) return false;
  if (!Number.isInteger(day) || day < 1 || day > daysInMonth(year, month)) return false;
  return true;
}

function tehranOffsetMinutesForUtc(date: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: TEHRAN_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = dtf.formatToParts(date);
  const map: Record<string, string> = {};
  for (const p of parts) {
    map[p.type] = p.value;
  }
  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour) === 24 ? 0 : Number(map.hour),
    Number(map.minute),
    Number(map.second),
  );
  return Math.round((asUtc - date.getTime()) / 60000);
}

function localToUtc(year: number, month: number, day: number, hour: number, minute: number, second: number, ms: number): Date {
  const naiveUtc = Date.UTC(year, month - 1, day, hour, minute, second, ms);
  const probe = new Date(naiveUtc);
  const offsetMin = tehranOffsetMinutesForUtc(probe);
  const adjusted = new Date(naiveUtc - offsetMin * 60000);
  const reOffset = tehranOffsetMinutesForUtc(adjusted);
  return new Date(naiveUtc - reOffset * 60000);
}

export function tehranDateToUtcRange(dateString: string): UtcDateRange | null {
  if (!dateString) return null;
  const m = DATE_RE.exec(dateString);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (!isValidYMD(year, month, day)) return null;

  const start = localToUtc(year, month, day, 0, 0, 0, 0);
  const end = localToUtc(year, month, day, 23, 59, 59, 999);

  return {
    startUtc: start.toISOString(),
    endUtc: end.toISOString(),
  };
}
