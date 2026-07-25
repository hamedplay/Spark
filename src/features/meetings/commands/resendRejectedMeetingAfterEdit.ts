import { getMeetingTemplateKey } from '../../../config/templateCatalog';
import { insertNotification } from '../../../lib/notifications';
import { supabase } from '../../../lib/supabase';

export interface ResendRejectedMeetingAfterEditInput {
  meetingId: string;
  meetingSubject: string;
  senderId: string;
}

interface SavedMeetingParticipantsRow {
  participant_user_ids: string[] | null;
}

interface ReinviteProfileRow {
  user_id: string;
  full_name: string | null;
}

export async function resendRejectedMeetingAfterEdit(
  input: ResendRejectedMeetingAfterEditInput
): Promise<void> {
  await supabase.rpc(
    'resend_meeting_invitations',
    {
      p_meeting_id: input.meetingId,
    }
  );

  const { data: savedMeeting } =
    await supabase
      .from('meetings')
      .select('participant_user_ids')
      .eq('id', input.meetingId)
      .maybeSingle();

  const savedParticipantData =
    savedMeeting as SavedMeetingParticipantsRow | null;

  const participantIds =
    (
      savedParticipantData
        ?.participant_user_ids ?? []
    ).filter(
      (userId) =>
        userId !== input.senderId
    );

  if (participantIds.length > 0) {
    const { data: profiles } =
      await supabase
        .from('profiles')
        .select('user_id, full_name')
        .in('user_id', participantIds);

    const nameMap: Record<string, string> = {};

    for (
      const profile of
        (profiles ?? []) as ReinviteProfileRow[]
    ) {
      nameMap[profile.user_id] =
        profile.full_name || '';
    }

    await Promise.all(
      participantIds.map((userId) =>
        insertNotification({
          userId,

          category: 'meeting',

          eventType: getMeetingTemplateKey(
            'participant',
            'invite'
          ),

          audience: 'participants',

          fallbackTitle:
            `دعوت مجدد به جلسه: ${input.meetingSubject}`,

          fallbackMessage:
            `جلسه «${input.meetingSubject}» ویرایش شد و مجدداً برای شما ارسال گردید`,

          placeholders: {
            meeting_subject:
              input.meetingSubject,

            full_name:
              nameMap[userId] || '',

            recipient_greeting:
              nameMap[userId]
                ? `${nameMap[userId]} گرامی`
                : 'همکار گرامی',
          },

          senderId: input.senderId,
          actionUrl: 'meetings',
        })
      )
    );
  }
}
