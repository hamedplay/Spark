import { getMeetingTemplateKey } from '../../../config/templateCatalog';
import { insertNotification } from '../../../lib/notifications';
import { supabase } from '../../../lib/supabase';

export interface DeleteAndRevertMeetingInput {
  meetingId: string;
  currentUserId: string;
}

interface RevertSourceMeetingRow {
  subject: string;
  location: string | null;
  representative: string | null;
  phone: string | null;
  notes: string | null;
  priority: string;

  participant_user_ids: string[] | null;

  notify_users: string[] | null;

  external_participants: string[] | null;

  meeting_manager: string | null;
}

interface ParticipantSnapshotRow {
  name: string;
}

interface ActionSnapshotRow {
  title: string;
  status: string;
  assignee: string;
}

interface ProfileRow {
  user_id: string;
  full_name: string | null;
}

export async function deleteAndRevertMeeting(
  input: DeleteAndRevertMeetingInput
): Promise<void> {
  const { data: sourceMeeting } =
    await supabase
      .from('meetings')
      .select(
        'subject, location, representative, phone, notes, priority, participant_user_ids, notify_users, external_participants, meeting_manager'
      )
      .eq('id', input.meetingId)
      .maybeSingle();

  if (!sourceMeeting) {
    throw new Error('جلسه یافت نشد');
  }

  const source =
    sourceMeeting as unknown as RevertSourceMeetingRow;

  const { data: oldParticipants } =
    await supabase
      .from('participants')
      .select('name')
      .eq('meeting_id', input.meetingId);

  const oldParticipantRows =
    (oldParticipants ?? []) as unknown as ParticipantSnapshotRow[];

  const { data: oldActions } =
    await supabase
      .from('actions')
      .select('title, status, assignee')
      .eq('meeting_id', input.meetingId);

  const oldActionRows =
    (oldActions ?? []) as unknown as ActionSnapshotRow[];

  const {
    data: newMeeting,
    error: insertError,
  } = await supabase
    .from('meetings')
    .insert([
      {
        subject: source.subject,

        location: source.location ?? null,

        representative:
          source.representative ?? null,

        phone: source.phone ?? null,

        notes: source.notes ?? null,

        priority: source.priority,

        participant_user_ids:
          source.participant_user_ids ?? [],

        notify_users: source.notify_users ?? [],

        external_participants:
          source.external_participants ?? [],

        meeting_manager:
          source.meeting_manager ?? null,

        user_id: input.currentUserId,

        status: 'open',
        status_type: 'approved',

        request_date: null,
        start_time: null,
        end_time: null,
        duration: null,

        repeat_type: null,
        repeat_interval: null,
        repeat_end_date: null,
        repeat_weekday: null,
      },
    ])
    .select('id')
    .single();

  if (insertError) {
    throw insertError;
  }

  const newMeetingId = newMeeting!.id;

  if (oldParticipantRows.length > 0) {
    await supabase
      .from('participants')
      .insert(
        oldParticipantRows.map((participant) => ({
          meeting_id: newMeetingId,
          name: participant.name,
        }))
      );
  }

  if (oldActionRows.length > 0) {
    await supabase
      .from('actions')
      .insert(
        oldActionRows.map(
          (action) => ({
            meeting_id: newMeetingId,
            title: action.title,
            status: action.status,
            assignee: action.assignee,
          })
        )
      );
  }

  const participantUserIds =
    source.participant_user_ids ?? [];

  const recipientIds = [
    ...participantUserIds,
    ...(source.notify_users ?? []),
  ].filter(
    (userId) =>
      userId !== input.currentUserId
  );

  if (recipientIds.length > 0) {
    const { data: profiles } =
      await supabase
        .from('profiles')
        .select('user_id, full_name')
        .in('user_id', recipientIds);

    const nameMap: Record<string, string> = {};

    for (
      const profile of
        (profiles ?? []) as ProfileRow[]
    ) {
      nameMap[profile.user_id] =
        profile.full_name || '';
    }

    await Promise.all(
      recipientIds.map((userId) => {
        const isParticipant =
          participantUserIds.includes(userId);

        return insertNotification({
          userId,

          category: 'meeting',

          eventType: getMeetingTemplateKey(
            isParticipant
              ? 'participant'
              : 'observer',
            'cancel'
          ),

          audience:
            isParticipant
              ? 'participants'
              : 'observers',

          fallbackTitle: 'جلسه لغو شد',

          fallbackMessage:
            `جلسه «${source.subject}» لغو شده است`,

          placeholders: {
            meeting_subject: source.subject,

            full_name:
              nameMap[userId] || '',

            recipient_greeting:
              nameMap[userId]
                ? `${nameMap[userId]} گرامی`
                : 'همکار گرامی',
          },

          senderId: input.currentUserId,
          actionUrl: 'meetings',
        });
      })
    );
  }

  await supabase
    .from('meeting_inbox')
    .delete()
    .eq('meeting_id', input.meetingId);

  const { error: deleteError } =
    await supabase
      .from('meetings')
      .delete()
      .eq('id', input.meetingId);

  if (deleteError) {
    throw deleteError;
  }
}
