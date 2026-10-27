/** Normalize a stored meeting date to its Tehran calendar day. */
export function meetingLocalDate(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error('تاریخ جلسه نامعتبر است');
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(parsed);
}
