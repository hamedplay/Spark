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

interface ExternalContactRow {
  name: string;
  phone: string | null;
}

function normalizeContactName(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

async function sendExternalCancellation(
  meetingId: string,
  meetingSubject: string,
  senderId: string | null
): Promise<void> {
  const { data: meeting, error: meetingError } = await supabase
    .from('meetings')
    .select('user_id, external_participants, send_sms, request_date, start_time, end_time')
    .eq('id', meetingId)
    .maybeSingle();

  if (meetingError) throw meetingError;
  if (meeting?.send_sms !== true) return;

  const externalNames = (meeting?.external_participants ?? []) as string[];
  if (externalNames.length === 0) return;

  const ownerUserId = meeting?.user_id ?? senderId;
  if (!ownerUserId) return;

  const { data: contacts, error: contactsError } = await supabase
    .from('contacts_email')
    .select('name, phone')
    .eq('user_id', ownerUserId);

  if (contactsError) throw contactsError;

  const requestedNames = new Set(externalNames.map(normalizeContactName));
  const mobiles = Array.from(new Set(
    ((contacts ?? []) as ExternalContactRow[])
      .filter(contact => requestedNames.has(normalizeContactName(contact.name)))
      .map(contact => contact.phone?.trim() || '')
      .filter(Boolean)
  ));

  if (mobiles.length === 0) return;

  const { data, error } = await supabase.functions.invoke('send-sms', {
    body: {
      mode: 'external',
      mobiles,
      meetingId,
      eventKey: `meeting:${meetingId}:cancel:external`,
      message: `جلسه «${meetingSubject}» لغو شده است`,
      category: 'meeting',
      eventType: 'cancel',
      context: {
        meeting_subject: meetingSubject,
        meeting_date: meeting?.request_date || '',
        start_time: meeting?.start_time || '',
        end_time: meeting?.end_time || '',
        meeting_time: [meeting?.start_time, meeting?.end_time].filter(Boolean).join(' - '),
      },
      triggeredByUserId: senderId,
    },
  });

  if (error) throw error;
  if (data?.ok === false) {
    throw new Error(data?.error || 'ارسال پیام لغو جلسه برای مهمانان خارج سازمان ناموفق بود');
  }
}

export async function deleteMeetingPermanently(
  input: DeleteMeetingPermanentlyInput
): Promise<void> {
  const { data: meetingContext, error: meetingContextError } = await supabase
    .from('meetings')
    .select('request_date, start_time, end_time')
    .eq('id', input.meetingId)
    .maybeSingle();

  if (meetingContextError) {
    throw meetingContextError;
  }

  const participantUserIds =
    input.participantUserIds;

  const recipientIds = Array.from(new Set([
    ...participantUserIds,
    ...input.notifyUserIds,
  ])).filter(
    (userId) =>
      userId !== input.senderId
  );

  if (recipientIds.length > 0) {
    const { data: profiles } =
      await supabase
        .from('profiles_public')
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

          meetingId: input.meetingId,

          eventKey:
            `meeting:${input.meetingId}:cancel:${isParticipant ? 'participants' : 'observers'}:${userId}`,

          placeholders: {
            meeting_subject:
              input.meetingSubject,

            meeting_date:
              meetingContext?.request_date || '',

            start_time:
              meetingContext?.start_time || '',

            end_time:
              meetingContext?.end_time || '',

            meeting_time:
              [meetingContext?.start_time, meetingContext?.end_time].filter(Boolean).join(' - '),

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

  await sendExternalCancellation(
    input.meetingId,
    input.meetingSubject,
    input.senderId
  );

  const { error: inboxDeleteError } = await supabase
    .from('meeting_inbox')
    .delete()
    .eq('meeting_id', input.meetingId);

  if (inboxDeleteError) {
    throw inboxDeleteError;
  }

  const { error } = await supabase
    .from('meetings')
    .delete()
    .eq('id', input.meetingId);

  if (error) {
    throw error;
  }
}
