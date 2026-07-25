import { getMeetingTemplateKey } from '../../../config/templateCatalog';
import { insertNotification } from '../../../lib/notifications';
import { supabase } from '../../../lib/supabase';

export interface DeleteMeetingPermanentlyInput {
  meetingId: string;
  meetingSubject: string;

  participantUserIds: string[];
  notifyUserIds: string[];

  senderId: string | null;
}

interface ProfileRow {
  user_id: string;
  full_name: string | null;
}

export async function deleteMeetingPermanently(
  input: DeleteMeetingPermanentlyInput
): Promise<void> {
  const participantUserIds =
    input.participantUserIds;

  const recipientIds = [
    ...participantUserIds,
    ...input.notifyUserIds,
  ].filter(
    (userId) =>
      userId !== input.senderId
  );

  if (recipientIds.length > 0) {
    const { data: profiles } =
      await supabase
        .from('profiles')
        .select('user_id, full_name')
        .in('user_id', recipientIds);

    const nameMap: Record<string, string> = {};

    for (const profile of (profiles ?? []) as ProfileRow[]) {
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

          fallbackTitle:
            'جلسه لغو شد',

          fallbackMessage:
            `جلسه «${input.meetingSubject}» لغو شده است`,

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
        });
      })
    );
  }

  await supabase
    .from('meeting_inbox')
    .delete()
    .eq('meeting_id', input.meetingId);

  const { error } = await supabase
    .from('meetings')
    .delete()
    .eq('id', input.meetingId);

  if (error) {
    throw error;
  }
}
