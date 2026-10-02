import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import type { AgendaItem, Meeting } from '../../../types';
import type { ParticipantStatusEntry } from '../types/meetingCard';

export interface MeetingCardPrefetchedReadModel {
  agendaItems: AgendaItem[];
  participantStatuses: Record<string, ParticipantStatusEntry>;
  delegateNames: Record<string, string>;
}

interface BatchReadModelState {
  byMeetingId: Record<string, MeetingCardPrefetchedReadModel>;
  loading: boolean;
}

const EMPTY_MODEL: MeetingCardPrefetchedReadModel = {
  agendaItems: [],
  participantStatuses: {},
  delegateNames: {},
};

function chunk<T>(items: T[], size = 100): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

export function useMeetingCardsBatchReadModel(
  meetings: Meeting[],
  currentUserId: string | null,
): BatchReadModelState {
  const [state, setState] = useState<BatchReadModelState>({ byMeetingId: {}, loading: false });

  const meetingIdsKey = meetings.map((meeting) => meeting.id).filter(Boolean).join(',');
  const creatorMeetingIdsKey = meetings
    .filter((meeting) =>
      Boolean(
        currentUserId &&
        meeting.user_id === currentUserId &&
        Array.isArray(meeting.participant_user_ids) &&
        meeting.participant_user_ids.length > 0,
      ))
    .map((meeting) => meeting.id)
    .join(',');

  useEffect(() => {
    const meetingIds = meetingIdsKey ? meetingIdsKey.split(',') : [];
    const creatorMeetingIds = creatorMeetingIdsKey ? creatorMeetingIdsKey.split(',') : [];

    if (meetingIds.length === 0) {
      setState({ byMeetingId: {}, loading: false });
      return;
    }

    let cancelled = false;
    setState((current) => ({ ...current, loading: true }));

    void (async () => {
      try {
        const agendaResults = await Promise.all(
          chunk(meetingIds).map((ids) =>
            supabase
              .from('meeting_agenda_items')
              .select('*')
              .in('meeting_id', ids)
              .order('sort_order')
          ),
        );

        const inboxResults = creatorMeetingIds.length > 0
          ? await Promise.all(
              chunk(creatorMeetingIds).map((ids) =>
                supabase
                  .from('meeting_inbox')
                  .select('meeting_id,user_id,status,delegate_to')
                  .in('meeting_id', ids)
              ),
            )
          : [];

        if (cancelled) return;

        const next: Record<string, MeetingCardPrefetchedReadModel> = {};
        for (const id of meetingIds) {
          next[id] = { ...EMPTY_MODEL, agendaItems: [], participantStatuses: {}, delegateNames: {} };
        }

        for (const result of agendaResults) {
          if (result.error) continue;
          for (const row of result.data ?? []) {
            const meetingId = String(row.meeting_id ?? '');
            if (!meetingId || !next[meetingId]) continue;
            next[meetingId].agendaItems.push(row as AgendaItem);
          }
        }

        const delegateIds = new Set<string>();
        for (const result of inboxResults) {
          if (result.error) continue;
          for (const row of result.data ?? []) {
            const meetingId = String(row.meeting_id ?? '');
            const userId = String(row.user_id ?? '');
            if (!meetingId || !userId || !next[meetingId]) continue;
            next[meetingId].participantStatuses[userId] = {
              status: row.status,
              delegate_to: row.delegate_to,
            };
            if (row.delegate_to) delegateIds.add(String(row.delegate_to));
          }
        }

        let delegateNameMap: Record<string, string> = {};
        if (delegateIds.size > 0) {
          const { data } = await supabase
            .from('profiles_public')
            .select('user_id,full_name,username')
            .in('user_id', Array.from(delegateIds));
          if (cancelled) return;
          delegateNameMap = Object.fromEntries(
            (data ?? []).map((profile) => [
              profile.user_id,
              profile.full_name || profile.username || profile.user_id,
            ]),
          );
        }

        for (const meetingId of creatorMeetingIds) {
          const model = next[meetingId];
          if (!model) continue;
          const relevantDelegateNames: Record<string, string> = {};
          for (const status of Object.values(model.participantStatuses)) {
            if (status.delegate_to && delegateNameMap[status.delegate_to]) {
              relevantDelegateNames[status.delegate_to] = delegateNameMap[status.delegate_to];
            }
          }
          model.delegateNames = relevantDelegateNames;
        }

        if (!cancelled) setState({ byMeetingId: next, loading: false });
      } catch {
        if (!cancelled) {
          // Keep cards functional with empty supplementary data instead of
          // falling back to an N+1 request pattern.
          const empty = Object.fromEntries(
            meetingIds.map((id) => [id, { agendaItems: [], participantStatuses: {}, delegateNames: {} }]),
          );
          setState({ byMeetingId: empty, loading: false });
        }
      }
    })();

    return () => { cancelled = true; };
  }, [meetingIdsKey, creatorMeetingIdsKey]);

  return state;
}
