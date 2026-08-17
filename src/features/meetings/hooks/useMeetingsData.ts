import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase, handleSupabaseError } from '../../../lib/supabase';
import type { Meeting } from '../../../types';
import toast from 'react-hot-toast';

interface MeetingsData {
  meetings: Meeting[];
  pendingMeetingsCount: number;
  fetchMeetings: () => Promise<void>;
  fetchPendingMeetingsCount: () => Promise<void>;
}

const REALTIME_REFRESH_DEBOUNCE_MS = 180;

/**
 * Loads the relatively heavy meetings dashboard dataset only while the caller
 * actually needs it. Data is intentionally retained while disabled so returning
 * to the meetings page can paint cached content immediately before refreshing.
 */
export function useMeetingsData(enabled: boolean, userId: string | null): MeetingsData {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [pendingMeetingsCount, setPendingMeetingsCount] = useState(0);
  const meetingsRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchPendingMeetingsCount = useCallback(async () => {
    if (!userId) return;

    try {
      const { count, error } = await supabase
        .from('shared_meetings')
        .select('id', { count: 'exact', head: true })
        .eq('recipient_id', userId)
        .eq('status', 'pending');

      if (error) throw error;
      setPendingMeetingsCount(count || 0);
    } catch (error) {
      console.error('Error fetching pending meetings count:', error);
    }
  }, [userId]);

  const fetchMeetings = useCallback(async () => {
    if (!userId) return;

    try {
      // The dashboard list and pending badge are independent queries. Running
      // them together removes a full network waterfall from every refresh.
      const [meetingsResult, pendingResult] = await Promise.all([
        supabase
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
          .eq('user_id', userId)
          .neq('status', 'closed')
          .order('created_at', { ascending: false }),
        supabase
          .from('shared_meetings')
          .select('id', { count: 'exact', head: true })
          .eq('recipient_id', userId)
          .eq('status', 'pending'),
      ]);

      if (meetingsResult.error) throw meetingsResult.error;
      if (pendingResult.error) throw pendingResult.error;

      const formattedMeetings: Meeting[] = (meetingsResult.data as unknown as Meeting[] || []).map(meeting => ({
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
      setPendingMeetingsCount(pendingResult.count || 0);
    } catch (error: unknown) {
      const handledError = handleSupabaseError(error);
      toast.error(handledError.message);
    }
  }, [userId]);

  const scheduleMeetingsRefresh = useCallback(() => {
    if (meetingsRefreshTimer.current) clearTimeout(meetingsRefreshTimer.current);
    meetingsRefreshTimer.current = setTimeout(() => {
      meetingsRefreshTimer.current = null;
      void fetchMeetings();
    }, REALTIME_REFRESH_DEBOUNCE_MS);
  }, [fetchMeetings]);

  const schedulePendingRefresh = useCallback(() => {
    if (pendingRefreshTimer.current) clearTimeout(pendingRefreshTimer.current);
    pendingRefreshTimer.current = setTimeout(() => {
      pendingRefreshTimer.current = null;
      void fetchPendingMeetingsCount();
    }, REALTIME_REFRESH_DEBOUNCE_MS);
  }, [fetchPendingMeetingsCount]);

  useEffect(() => {
    if (!enabled || !userId) return;

    void fetchMeetings();

    const channel = supabase
      .channel(`app-meetings-realtime-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'meetings' }, scheduleMeetingsRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'participants' }, scheduleMeetingsRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'actions' }, scheduleMeetingsRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shared_meetings' }, schedulePendingRefresh)
      .subscribe();

    return () => {
      if (meetingsRefreshTimer.current) {
        clearTimeout(meetingsRefreshTimer.current);
        meetingsRefreshTimer.current = null;
      }
      if (pendingRefreshTimer.current) {
        clearTimeout(pendingRefreshTimer.current);
        pendingRefreshTimer.current = null;
      }
      void supabase.removeChannel(channel);
    };
  }, [enabled, userId, fetchMeetings, scheduleMeetingsRefresh, schedulePendingRefresh]);

  return { meetings, pendingMeetingsCount, fetchMeetings, fetchPendingMeetingsCount };
}
