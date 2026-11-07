import { dispatchRecurringMeetingDelivery } from './dispatchRecurringMeetingDelivery';
import { supabase } from '../../../lib/supabase';

type SeriesClient = { rpc(name: string, args: Record<string, unknown>): Promise<{ data: string[] | null; error: { message: string } | null }> };
/** One command commits occurrences, inbox invitations, agenda and delivery events. */
export async function createMeetingSeries(operationId: string, records: object[], agenda: object[], pattern: string, firstOccurrenceAgenda?: object[]): Promise<string[]> {
  const { data, error } = await (supabase as unknown as SeriesClient).rpc('create_meeting_series', {
    p_operation_id: operationId, p_records: records, p_agenda: agenda, p_pattern: pattern,
  });
  if (error) throw new Error(error.message.includes('OPERATION_CONFLICT') ? 'این درخواست قبلاً با اطلاعات دیگری ثبت شده است؛ پیش از ثبت مجدد، تقویم را بررسی کنید.' : error.message);
  if (!data?.length) throw new Error('ثبت جلسات تکراری تأیید نشد');
  // A chosen prior decision is linked only to the first occurrence by default.
  if (firstOccurrenceAgenda) {
    const { error: agendaError } = await (supabase as any).rpc('sync_linked_meeting_agenda_v1', {
      p_meeting_id: data[0], p_items: firstOccurrenceAgenda,
    });
    if (agendaError) throw new Error('سری ایجاد شد اما ثبت ارتباط مصوبات نوبت اول ناموفق بود: ' + agendaError.message);
  }
  await dispatchRecurringMeetingDelivery(operationId);
  return data;
}
