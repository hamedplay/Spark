import { supabase } from '../../../lib/supabase';
import type { AgendaItem } from '../../../types';

export type MeetingAgendaInput = Pick<
  AgendaItem,
  | 'title'
  | 'presenter'
  | 'duration_minutes'
  | 'sort_order'
  | 'description'
> & { id?: string; source_decision_id?: string | null };

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
    id: it.id,
    source_decision_id: (it as { source_decision_id?: string | null }).source_decision_id ?? null,
    title: it.title,
    presenter: it.presenter,
    duration_minutes: it.duration_minutes,
    sort_order: it.sort_order,
    description: it.description,
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
        title: item.title,
        source_decision_id: item.source_decision_id ?? null,
        presenter: item.presenter,
        duration_minutes: item.duration_minutes,
        description: item.description,
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
  const { error } = await (supabase as any).rpc('sync_linked_meeting_agenda_v1', {
    p_meeting_id: meetingId,
    p_items: items.map(item => ({
      id: item.id || crypto.randomUUID(), title: item.title, presenter: item.presenter,
      duration_minutes: item.duration_minutes, description: item.description,
      source_decision_id: item.source_decision_id ?? null,
    })),
  });
  if (error) throw error;
}
