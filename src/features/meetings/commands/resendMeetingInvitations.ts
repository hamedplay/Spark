import { getMeetingTemplateKey } from '../../../config/templateCatalog';
import { insertNotification } from '../../../lib/notifications';
import { supabase } from '../../../lib/supabase';

export interface ResendMeetingInvitationsInput {
  meetingId: string;
  meetingSubject: string;
  senderId: string;
}

interface InboxRow {
  user_id: string;
}

export async function resendMeetingInvitations(
  input: ResendMeetingInvitationsInput
): Promise<void> {
  const { error } = await supabase.rpc(
    'resend_meeting_invitations',
    {
      p_meeting_id: input.meetingId,
    }
  );

  if (error) {
    throw error;
  }

  const { data: pendingRows } =
    await supabase
      .from('meeting_inbox')
      .select('user_id')
      .eq('meeting_id', input.meetingId)
      .eq('status', 'pending');

  const notifyIds = (pendingRows ?? []).map(
    (row: InboxRow) => row.user_id
  );

  if (notifyIds.length > 0) {
    const { data: notifyProfiles } =
      await supabase
        .from('profiles')
        .select('user_id, full_name')
        .in('user_id', notifyIds);

    const nameMap: Record<string, string> = {};

    for (const profile of notifyProfiles ?? []) {
      nameMap[profile.user_id] =
        profile.full_name || '';
    }

    await Promise.all(
      notifyIds.map((userId) =>
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
            `شما مجدداً به جلسه «${input.meetingSubject}» دعوت شده‌اید`,

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
