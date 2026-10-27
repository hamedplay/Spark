import { supabase } from '../../../lib/supabase';

type SeriesClient = { rpc(name: string, args: Record<string, unknown>): Promise<{ data: string[] | null; error: { message: string } | null }> };
/** One command commits occurrences, inbox invitations, agenda and delivery events. */
export async function createMeetingSeries(operationId: string, records: object[], agenda: object[], pattern: string): Promise<string[]> {
  const { data, error } = await (supabase as unknown as SeriesClient).rpc('create_meeting_series', {
    p_operation_id: operationId, p_records: records, p_agenda: agenda, p_pattern: pattern,
  });
  if (error) throw new Error(error.message.includes('OPERATION_CONFLICT') ? 'این درخواست قبلاً با اطلاعات دیگری ثبت شده است؛ پیش از ثبت مجدد، تقویم را بررسی کنید.' : error.message);
  if (!data?.length) throw new Error('ثبت جلسات تکراری تأیید نشد');
  return data;
}
