import { supabase } from '../../../lib/supabase';
import type { AgendaItem } from '../../../types';

export type MeetingAgendaInput = Pick<
  AgendaItem,
  | 'title'
  | 'presenter'
  | 'duration_minutes'
  | 'sort_order'
>;

export async function fetchMeetingAgendaItems(
  meetingId: string
): Promise<MeetingAgendaInput[]> {
  const { data, error } = await supabase
    .from('meeting_agenda_items')
    .select('*')
    .eq('meeting_id', meetingId)
    .order('sort_order');
  if (error) throw error;
  return (data ?? []).map((it) => ({
    title: it.title,
    presenter: it.presenter,
    duration_minutes: it.duration_minutes,
    sort_order: it.sort_order,
  }));
}

export async function insertMeetingAgendaItems(
  meetingId: string,
  items: MeetingAgendaInput[]
): Promise<void> {
  if (items.length === 0) return;
  const { error } = await supabase
    .from('meeting_agenda_items')
    .insert(
      items.map((item, index) => ({
        ...item,
        meeting_id: meetingId,
        sort_order: index,
      }))
    );
  if (error) throw error;
}

export async function replaceMeetingAgendaItems(
  meetingId: string,
  items: MeetingAgendaInput[]
): Promise<void> {
  const { error: deleteError } = await supabase
    .from('meeting_agenda_items')
    .delete()
    .eq('meeting_id', meetingId);
  if (deleteError) throw deleteError;

  if (items.length > 0) {
    await insertMeetingAgendaItems(meetingId, items);
  }
}
