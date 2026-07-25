import { useState, useEffect } from 'react';
import { supabase } from '../../../lib/supabase';
import type { Meeting, AgendaItem } from '../../../types';
import type { ParticipantStatusEntry } from '../types/meetingCard';

type MeetingWithParticipantIds = Meeting & {
  participant_user_ids?: string[];
};

interface UseMeetingCardReadModelResult {
  currentUserId: string | null;
  agendaItems: AgendaItem[];
  participantUserIds: string[];
  participantStatuses: Record<string, ParticipantStatusEntry>;
  delegateNames: Record<string, string>;
  isCreator: boolean;
}

export function useMeetingCardReadModel(meeting: Meeting): UseMeetingCardReadModelResult {
  const [participantStatuses, setParticipantStatuses] = useState<Record<string, ParticipantStatusEntry>>({});
  const [delegateNames, setDelegateNames] = useState<Record<string, string>>({});
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [agendaItems, setAgendaItems] = useState<AgendaItem[]>([]);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setCurrentUserId(user.id);
    });
  }, []);

  useEffect(() => {
    if (!meeting.id) return;
    supabase
      .from('meeting_agenda_items')
      .select('*')
      .eq('meeting_id', meeting.id)
      .order('sort_order')
      .then(({ data }) => { if (data) setAgendaItems(data as AgendaItem[]); });
  }, [meeting.id]);

  const meetingWithParticipantIds = meeting as MeetingWithParticipantIds;
  const participantUserIds = meetingWithParticipantIds.participant_user_ids ?? [];
  const participantUserIdsKey = participantUserIds.join(',');
  const hasParticipantUserIds = participantUserIds.length > 0;
  const { id: meetingId, user_id: meetingUserId } = meeting;

  useEffect(() => {
    const isCreator = meetingUserId && currentUserId && meetingUserId === currentUserId;
    if (!isCreator || !meetingId) return;
    if (!hasParticipantUserIds) return;

    supabase
      .from('meeting_inbox')
      .select('user_id, status, delegate_to')
      .eq('meeting_id', meetingId)
      .then(({ data }) => {
        if (!data) return;
        const map: Record<string, ParticipantStatusEntry> = {};
        const delegateIds: string[] = [];
        for (const row of data) {
          map[row.user_id] = { status: row.status, delegate_to: row.delegate_to };
          if (row.delegate_to) delegateIds.push(row.delegate_to);
        }
        setParticipantStatuses(map);

        if (delegateIds.length > 0) {
          supabase.from('profiles').select('user_id, full_name, email').in('user_id', delegateIds).then(({ data: profiles }) => {
            if (!profiles) return;
            const names: Record<string, string> = {};
            for (const p of profiles) names[p.user_id] = p.full_name || p.email || p.user_id;
            setDelegateNames(names);
          });
        }
      });
  }, [meetingId, meetingUserId, currentUserId, participantUserIdsKey, hasParticipantUserIds]);

  const isCreator = !!(meetingUserId && currentUserId && meetingUserId === currentUserId);

  return {
    currentUserId,
    agendaItems,
    participantUserIds,
    participantStatuses,
    delegateNames,
    isCreator,
  };
}
