import { useState, useEffect, useCallback } from 'react';
import { supabase, handleSupabaseError } from '../../../lib/supabase';
import { Meeting } from '../../../types';
import toast from 'react-hot-toast';

interface MeetingsData {
  meetings: Meeting[];
  pendingMeetingsCount: number;
  fetchMeetings: () => Promise<void>;
  fetchPendingMeetingsCount: () => Promise<void>;
}

export function useMeetingsData(isAuthenticated: boolean): MeetingsData {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [pendingMeetingsCount, setPendingMeetingsCount] = useState(0);

  const fetchPendingMeetingsCount = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { count, error } = await supabase
        .from('shared_meetings')
        .select('id', { count: 'exact', head: true })
        .eq('recipient_id', user.id)
        .eq('status', 'pending');

      if (error) throw error;

      setPendingMeetingsCount(count || 0);
    } catch (error) {
      console.error('Error fetching pending meetings count:', error);
    }
  }, []);

  const fetchMeetings = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from('meetings')
        .select(`
          *,
          participants (
            id,
            name
          ),
          actions (
            id,
            title,
            status,
            assignee
          )
        `)
        .eq('user_id', user.id)
        .neq('status', 'closed')
        .order('created_at', { ascending: false });

      if (error) throw error;

      const formattedMeetings: Meeting[] = (data as unknown as Meeting[] || []).map(meeting => ({
        id: meeting.id,
        subject: meeting.subject,
        requestDate: meeting.request_date,
        duration: meeting.duration,
        location: meeting.location,
        representative: meeting.representative,
        phone: meeting.phone,
        notes: meeting.notes,
        priority: meeting.priority,
        status: meeting.status,
        status_type: meeting.status_type || 'requested',
        participants: meeting.participants?.map((p: { name: string }) => p.name) || [],
        actions: meeting.actions || [],
        created_at: meeting.created_at,
        user_id: meeting.user_id,
        guest_emails: meeting.guest_emails || [],
        start_time: meeting.start_time || null,
        end_time: meeting.end_time || null,
        archived_participant_ids: meeting.archived_participant_ids || null,
      }));

      setMeetings(formattedMeetings);

      fetchPendingMeetingsCount();
    } catch (error: unknown) {
      const handledError = handleSupabaseError(error);
      toast.error(handledError.message);
    }
  }, [fetchPendingMeetingsCount]);

  useEffect(() => {
    if (!isAuthenticated) {
      setMeetings([]);
      setPendingMeetingsCount(0);
      return;
    }
    fetchMeetings();

    const channel = supabase
      .channel(`app-meetings-realtime-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'meetings' }, () => fetchMeetings())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'participants' }, () => fetchMeetings())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'actions' }, () => fetchMeetings())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shared_meetings' }, () => {
        fetchMeetings();
        fetchPendingMeetingsCount();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [isAuthenticated, fetchMeetings, fetchPendingMeetingsCount]);

  return { meetings, pendingMeetingsCount, fetchMeetings, fetchPendingMeetingsCount };
}
