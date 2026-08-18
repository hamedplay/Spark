import type { MutableRefObject } from 'react';
import moment from 'moment-jalaali';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';
import { insertNotification } from '../../lib/notifications';
import type { SmsDispatchResult } from '../../lib/notifications';
import { getMeetingTemplateKey } from '../../config/templateCatalog';
import { computeExternalDiff } from '../../lib/meetingEditDiff';
import type { ContactEmail } from '../../types';
import type { CommitSnapshot } from './types';
import {
  createConferenceRoom,
  sendSmsToExternals,
  showSmsSummary,
  type ExternalSmsResult,
} from './services';

interface CommitEditContext {
  snapshot: CommitSnapshot;
  notifyExistingParticipants: boolean;
  userId: string | null;
  prefillMeetingId: string | null;
  prefillEditAllIds: string[] | null;
  subject: string;
  startTime: string;
  endTime: string;
  contacts: ContactEmail[];
  commitLockRef: MutableRefObject<boolean>;
  setCommitting: (value: boolean) => void;
  setEditDecision: (value: null) => void;
  onSuccess: (subject?: string, isUpdate?: boolean) => void;
}

type MeetingParticipantDiff = {
  meeting_id: string;
  added_participant_ids: string[];
  retained_participant_ids: string[];
  removed_participant_ids: string[];
};

export async function commitCalendarMeetingEdit({
  snapshot,
  notifyExistingParticipants,
  userId,
  prefillMeetingId,
  prefillEditAllIds,
  subject,
  startTime,
  endTime,
  contacts,
  commitLockRef,
  setCommitting,
  setEditDecision,
  onSuccess,
}: CommitEditContext) {
  if (!userId || !prefillMeetingId) return;
  if (commitLockRef.current) return;
  commitLockRef.current = true;
  setCommitting(true);
  const { operationId } = snapshot;

  try {
    const {
      updateRecord,
      baseFields,
      isFirstSchedule,
      senderName,
      meetingDateStr,
      meetingTimeStr,
      smsPlaceholders,
      agendaSummary,
      participantNameMap,
      observerIds,
      gregDate,
      selectedParticipantIds,
      selectedExternal,
      sendSms,
      agendaEnabled,
      agendaItems,
    } = snapshot;

    if (baseFields && prefillEditAllIds && prefillEditAllIds.length > 0) {
      const { error } = await supabase.from('meetings').update(baseFields).in('id', prefillEditAllIds);
      if (error) throw error;
    } else {
      const { error } = await supabase.from('meetings').update(updateRecord).eq('id', prefillMeetingId);
      if (error) throw error;
    }

    if (snapshot.isOnline && !snapshot.wasOnline) {
      const room = await createConferenceRoom(userId, subject);
      if (!room?.id) throw new Error('خطا در ایجاد اتاق جلسه آنلاین؛ لطفاً دوباره تلاش کنید');
      const { error: roomUpdateError } = await supabase
        .from('meetings')
        .update({ conference_room_id: room.id })
        .eq('id', prefillMeetingId);
      if (roomUpdateError) throw roomUpdateError;
    }

    const { error: agendaDeleteError } = await supabase
      .from('meeting_agenda_items')
      .delete()
      .eq('meeting_id', prefillMeetingId);
    if (agendaDeleteError) throw new Error('خطا در ذخیره دستور جلسه؛ لطفاً دوباره تلاش کنید');

    if (agendaEnabled && agendaItems.length > 0) {
      const { error: agendaInsertError } = await supabase.from('meeting_agenda_items').insert(
        agendaItems.map((item, index) => ({
          meeting_id: prefillMeetingId,
          title: item.title,
          presenter: item.presenter || null,
          duration_minutes: item.duration_minutes || null,
          description: ('description' in item ? String((item as Record<string, unknown>).description ?? '') : '') || null,
          sort_order: index,
        })),
      );
      if (agendaInsertError) throw new Error('خطا در ذخیره دستور جلسه؛ لطفاً دوباره تلاش کنید');
    }

    let meetingDiffs: MeetingParticipantDiff[] = [];
    if (prefillEditAllIds && prefillEditAllIds.length > 0) {
      const { data: bulkResult, error: syncError } = await supabase.rpc('sync_meeting_participants_bulk_v2', {
        p_meeting_ids: prefillEditAllIds,
        p_participant_user_ids: selectedParticipantIds,
      });
      if (syncError) throw new Error(syncError.message || 'خطا در همگام‌سازی شرکت‌کنندگان');
      meetingDiffs = (bulkResult || []) as MeetingParticipantDiff[];
      if (import.meta.env?.DEV) {
        console.debug('[commitEdit] sync_meeting_participants_bulk_v2', { rawBulkResult: bulkResult, meetingDiffs });
      }
    } else {
      const { data: syncResult, error: syncError } = await supabase.rpc('sync_meeting_participants_v2', {
        p_meeting_id: prefillMeetingId,
        p_participant_user_ids: selectedParticipantIds,
      });
      if (syncError) throw new Error(syncError.message || 'خطا در همگام‌سازی شرکت‌کنندگان');
      const normalizedSyncResult = Array.isArray(syncResult) ? syncResult[0] : syncResult;
      if (import.meta.env?.DEV) {
        console.debug('[commitEdit] sync_meeting_participants_v2', {
          rawSyncResult: syncResult,
          normalizedSyncResult,
          isArray: Array.isArray(syncResult),
          added: normalizedSyncResult?.added_participant_ids ?? [],
          retained: normalizedSyncResult?.retained_participant_ids ?? [],
          removed: normalizedSyncResult?.removed_participant_ids ?? [],
        });
      }
      meetingDiffs = [{
        meeting_id: prefillMeetingId,
        added_participant_ids: (normalizedSyncResult?.added_participant_ids ?? []) as string[],
        retained_participant_ids: (normalizedSyncResult?.retained_participant_ids ?? []) as string[],
        removed_participant_ids: (normalizedSyncResult?.removed_participant_ids ?? []) as string[],
      }];
    }

    const internalSmsResults: SmsDispatchResult[] = [];
    const externalSmsResults: ExternalSmsResult[] = [];

    if (import.meta.env?.DEV) {
      console.debug('[commitEdit] notification dispatch', {
        notifyExistingParticipants,
        operationId: snapshot.operationId,
        prefillMeetingId,
        selectedParticipantIds,
        prevParticipantIds: snapshot.prevParticipantIds,
        meetingDiffs,
        changeSetsByMeetingId: snapshot.changeSetsByMeetingId,
      });
    }

    if (!notifyExistingParticipants) {
      showSmsSummary(internalSmsResults, null);
      setEditDecision(null);
      onSuccess(subject, !!prefillMeetingId);
      return;
    }

    if (isFirstSchedule) {
      const creatorEventType = getMeetingTemplateKey('creator', 'created');
      await insertNotification({
        userId,
        category: 'meeting',
        eventType: creatorEventType,
        fallbackTitle: 'جلسه زمان‌بندی شد',
        fallbackMessage: `جلسه "${subject}" زمان‌بندی شد${agendaSummary}`,
        placeholders: {
          ...smsPlaceholders,
          full_name: senderName,
          recipient_greeting: `${senderName} گرامی`,
        },
        senderId: userId,
        senderName,
        actionUrl: 'calendar',
        channels: { inApp: true, sms: false, bale: false },
        eventKey: `${operationId}:${prefillMeetingId}:${userId}:creator:${creatorEventType}`,
      });
    }

    const bulkMeetingDetails = new Map<string, {
      subject: string;
      request_date: string;
      start_time: string | null;
      end_time: string | null;
    }>();
    if (meetingDiffs.length > 1) {
      const bulkIds = meetingDiffs.map(diff => diff.meeting_id);
      const { data: bulkMeetings } = await supabase
        .from('meetings')
        .select('id, subject, request_date, start_time, end_time')
        .in('id', bulkIds);
      for (const meeting of bulkMeetings || []) {
        bulkMeetingDetails.set(meeting.id, {
          subject: meeting.subject,
          request_date: meeting.request_date,
          start_time: meeting.start_time,
          end_time: meeting.end_time,
        });
      }
    }

    const sentNotificationKeys = new Set<string>();
    for (const diff of meetingDiffs) {
      const isBulk = meetingDiffs.length > 1;
      const details = bulkMeetingDetails.get(diff.meeting_id);
      const meetingSubject = isBulk ? (details?.subject || subject) : subject;
      const meetingDate = isBulk ? (details?.request_date || gregDate) : gregDate;
      const meetingStartTime = isBulk ? (details?.start_time || startTime) : startTime;
      const meetingEndTime = isBulk ? (details?.end_time || endTime) : endTime;
      const currentTime = meetingStartTime && meetingEndTime
        ? `${meetingStartTime}-${meetingEndTime}`
        : meetingStartTime || '';
      let jalaliDate = '';
      if (meetingDate) {
        try {
          const jalaliMoment = moment(meetingDate);
          if (jalaliMoment.isValid()) jalaliDate = jalaliMoment.format('jYYYY/jMM/jDD');
        } catch {
          // Preserve existing parse fallback.
        }
      }
      const currentPlaceholders: Record<string, string> = {
        ...smsPlaceholders,
        meeting_subject: meetingSubject,
        meeting_date: jalaliDate,
        start_time: meetingStartTime || '',
        end_time: meetingEndTime || '',
        meeting_time: currentTime,
      };
      const meetingChangeSet = snapshot.changeSetsByMeetingId[diff.meeting_id];

      if (diff.added_participant_ids.length) {
        const eventType = getMeetingTemplateKey('participant', 'invite');
        for (const recipientId of diff.added_participant_ids) {
          const dedupeKey = `${operationId}:${diff.meeting_id}:${recipientId}:participants:${eventType}`;
          if (sentNotificationKeys.has(dedupeKey)) continue;
          sentNotificationKeys.add(dedupeKey);
          const result = await insertNotification({
            userId: recipientId,
            category: 'meeting',
            eventType,
            audience: 'participants',
            fallbackTitle: 'دعوت به جلسه',
            fallbackMessage: `شما به جلسه "${meetingSubject}" دعوت شدید — ${currentTime}${jalaliDate ? ` در ${jalaliDate}` : ''}${agendaSummary}`,
            placeholders: {
              ...currentPlaceholders,
              full_name: participantNameMap[recipientId] || '',
              recipient_greeting: participantNameMap[recipientId] ? `${participantNameMap[recipientId]} گرامی` : 'همکار گرامی',
            },
            senderId: userId,
            senderName,
            actionUrl: 'calendar',
            eventKey: `${operationId}:${diff.meeting_id}:${recipientId}:participants:${eventType}`,
          });
          internalSmsResults.push(result);
        }
      }

      if (diff.removed_participant_ids.length) {
        const eventType = getMeetingTemplateKey('participant', 'cancel');
        for (const recipientId of diff.removed_participant_ids) {
          const dedupeKey = `${operationId}:${diff.meeting_id}:${recipientId}:participants:${eventType}`;
          if (sentNotificationKeys.has(dedupeKey)) continue;
          sentNotificationKeys.add(dedupeKey);
          const result = await insertNotification({
            userId: recipientId,
            category: 'meeting',
            eventType,
            audience: 'participants',
            fallbackTitle: 'لغو دعوت',
            fallbackMessage: `دعوت شما برای جلسه "${meetingSubject}" لغو شد — ${currentTime}${jalaliDate ? ` در ${jalaliDate}` : ''}`,
            placeholders: {
              ...currentPlaceholders,
              full_name: participantNameMap[recipientId] || '',
              recipient_greeting: participantNameMap[recipientId] ? `${participantNameMap[recipientId]} گرامی` : 'همکار گرامی',
            },
            senderId: userId,
            senderName,
            actionUrl: 'calendar',
            eventKey: `${operationId}:${diff.meeting_id}:${recipientId}:participants:${eventType}`,
          });
          internalSmsResults.push(result);
        }
      }

      if (!isFirstSchedule && (meetingChangeSet?.importantFields.length ?? 0) > 0 && diff.retained_participant_ids.length) {
        const eventType = getMeetingTemplateKey('participant', 'change');
        for (const recipientId of diff.retained_participant_ids) {
          const dedupeKey = `${operationId}:${diff.meeting_id}:${recipientId}:participants:${eventType}`;
          if (sentNotificationKeys.has(dedupeKey)) continue;
          sentNotificationKeys.add(dedupeKey);
          const result = await insertNotification({
            userId: recipientId,
            category: 'meeting',
            eventType,
            audience: 'participants',
            fallbackTitle: 'تغییر در جلسه',
            fallbackMessage: `جلسه "${meetingSubject}" ویرایش شد — ${currentTime}${jalaliDate ? ` در ${jalaliDate}` : ''}${agendaSummary}`,
            placeholders: {
              ...currentPlaceholders,
              full_name: participantNameMap[recipientId] || '',
              recipient_greeting: participantNameMap[recipientId] ? `${participantNameMap[recipientId]} گرامی` : 'همکار گرامی',
            },
            senderId: userId,
            senderName,
            actionUrl: 'calendar',
            eventKey: `${operationId}:${diff.meeting_id}:${recipientId}:participants:${eventType}`,
          });
          internalSmsResults.push(result);
        }
      }

      const previousNotifyForMeeting = new Set<string>(
        (snapshot.previousNotifyUserIdsByMeetingId[diff.meeting_id] || []).filter(value => value),
      );
      const addedObserverIds = observerIds.filter(id => !previousNotifyForMeeting.has(id));
      const retainedObserverIds = observerIds.filter(id => previousNotifyForMeeting.has(id));
      const removedObserverIds = [...previousNotifyForMeeting].filter(id => !observerIds.includes(id));

      if (addedObserverIds.length) {
        const eventType = getMeetingTemplateKey('observer', 'invite');
        for (const recipientId of addedObserverIds) {
          const dedupeKey = `${operationId}:${diff.meeting_id}:${recipientId}:observers:${eventType}`;
          if (sentNotificationKeys.has(dedupeKey)) continue;
          sentNotificationKeys.add(dedupeKey);
          const result = await insertNotification({
            userId: recipientId,
            category: 'meeting',
            eventType,
            audience: 'observers',
            fallbackTitle: 'اطلاع از جلسه',
            fallbackMessage: `شما به عنوان مطلع جلسه "${meetingSubject}" ثبت شده‌اید — ${currentTime}${jalaliDate ? ` در ${jalaliDate}` : ''}${agendaSummary}`,
            placeholders: {
              ...currentPlaceholders,
              full_name: participantNameMap[recipientId] || '',
              recipient_greeting: participantNameMap[recipientId] ? `${participantNameMap[recipientId]} گرامی` : 'همکار گرامی',
            },
            senderId: userId,
            senderName,
            actionUrl: 'calendar',
            eventKey: `${operationId}:${diff.meeting_id}:${recipientId}:observers:${eventType}`,
          });
          internalSmsResults.push(result);
        }
      }

      if (removedObserverIds.length) {
        const eventType = getMeetingTemplateKey('observer', 'cancel');
        for (const recipientId of removedObserverIds) {
          const dedupeKey = `${operationId}:${diff.meeting_id}:${recipientId}:observers:${eventType}`;
          if (sentNotificationKeys.has(dedupeKey)) continue;
          sentNotificationKeys.add(dedupeKey);
          const result = await insertNotification({
            userId: recipientId,
            category: 'meeting',
            eventType,
            audience: 'observers',
            fallbackTitle: 'لغو اطلاع',
            fallbackMessage: `اطلاع‌رسانی شما برای جلسه "${meetingSubject}" لغو شد — ${currentTime}${jalaliDate ? ` در ${jalaliDate}` : ''}`,
            placeholders: {
              ...currentPlaceholders,
              full_name: participantNameMap[recipientId] || '',
              recipient_greeting: participantNameMap[recipientId] ? `${participantNameMap[recipientId]} گرامی` : 'همکار گرامی',
            },
            senderId: userId,
            senderName,
            actionUrl: 'calendar',
            eventKey: `${operationId}:${diff.meeting_id}:${recipientId}:observers:${eventType}`,
          });
          internalSmsResults.push(result);
        }
      }

      if (!isFirstSchedule && (meetingChangeSet?.importantFields.length ?? 0) > 0 && retainedObserverIds.length) {
        const eventType = getMeetingTemplateKey('observer', 'change');
        for (const recipientId of retainedObserverIds) {
          const dedupeKey = `${operationId}:${diff.meeting_id}:${recipientId}:observers:${eventType}`;
          if (sentNotificationKeys.has(dedupeKey)) continue;
          sentNotificationKeys.add(dedupeKey);
          const result = await insertNotification({
            userId: recipientId,
            category: 'meeting',
            eventType,
            audience: 'observers',
            fallbackTitle: 'تغییر در جلسه',
            fallbackMessage: `جلسه "${meetingSubject}" ویرایش شد — ${currentTime}${jalaliDate ? ` در ${jalaliDate}` : ''}${agendaSummary}`,
            placeholders: {
              ...currentPlaceholders,
              full_name: participantNameMap[recipientId] || '',
              recipient_greeting: participantNameMap[recipientId] ? `${participantNameMap[recipientId]} گرامی` : 'همکار گرامی',
            },
            senderId: userId,
            senderName,
            actionUrl: 'calendar',
            eventKey: `${operationId}:${diff.meeting_id}:${recipientId}:observers:${eventType}`,
          });
          internalSmsResults.push(result);
        }
      }

      if (sendSms) {
        const previousExternal = snapshot.prevExternalByMeetingId[diff.meeting_id] || [];
        const externalDiff = computeExternalDiff(previousExternal, selectedExternal);
        const inviteFallback = `دعوت به جلسه: «${meetingSubject}» | تاریخ: ${jalaliDate || meetingDateStr} | ساعت: ${currentTime}${currentPlaceholders.location_part}`;
        if (externalDiff.added.length > 0) {
          externalSmsResults.push(await sendSmsToExternals(
            externalDiff.added,
            contacts,
            inviteFallback,
            userId,
            currentPlaceholders,
            'invite',
          ));
        }
        if (!isFirstSchedule && (meetingChangeSet?.importantFields.length ?? 0) > 0 && externalDiff.retained.length > 0) {
          const changeFallback = `تغییر جلسه: «${meetingSubject}» | تاریخ: ${jalaliDate || meetingDateStr} | ساعت: ${currentTime}${currentPlaceholders.location_part}`;
          externalSmsResults.push(await sendSmsToExternals(
            externalDiff.retained,
            contacts,
            changeFallback,
            userId,
            currentPlaceholders,
            'change',
          ));
        }
        if (externalDiff.removed.length > 0) {
          const cancelFallback = `لغو دعوت: جلسه «${meetingSubject}» در تاریخ ${jalaliDate || meetingDateStr} لغو شد.`;
          externalSmsResults.push(await sendSmsToExternals(
            externalDiff.removed,
            contacts,
            cancelFallback,
            userId,
            currentPlaceholders,
            'cancel',
          ));
        }
      }
    }

    let externalSmsResult: ExternalSmsResult | null = null;
    if (externalSmsResults.length > 0) {
      externalSmsResult = externalSmsResults.reduce((accumulator, result) => ({
        ok: accumulator.ok && result.ok,
        sent: accumulator.sent + result.sent,
        skipped: accumulator.skipped + result.skipped,
        error: accumulator.error || result.error,
      }));
    }

    const succeeded = internalSmsResults.filter(result => result.status === 'sent' || result.status === 'skipped').length;
    const failed = internalSmsResults.filter(result => result.status === 'failed').length;
    const totalEvents = internalSmsResults.length + externalSmsResults.length;
    if (import.meta.env?.DEV) {
      console.debug('[commitEdit] dispatch summary', {
        totalEvents,
        succeeded,
        failed,
        internalSmsResults,
        externalSmsResults,
        meetingDiffs,
      });
    }

    const hasAnyDiff = meetingDiffs.some(diff =>
      diff.added_participant_ids.length > 0
      || diff.removed_participant_ids.length > 0
      || diff.retained_participant_ids.length > 0,
    );
    if (failed > 0) {
      toast.error(`تغییرات جلسه ذخیره شد، اما اطلاع‌رسانی برای ${failed} نفر ناموفق بود.`);
    } else if (succeeded > 0) {
      toast.success('تغییرات جلسه ذخیره شد و اطلاع‌رسانی انجام شد.');
    } else if (hasAnyDiff) {
      console.warn('[commitEdit] Notification requested but zero events dispatched despite non-empty diff', { meetingDiffs });
      toast.error('تغییرات جلسه ذخیره شد، اما هیچ اطلاع‌رسانی انجام نشد. لطفاً مجدداً تلاش کنید.');
    }

    showSmsSummary(internalSmsResults, externalSmsResult);
    setEditDecision(null);
    onSuccess(subject, !!prefillMeetingId);
  } catch (error: any) {
    toast.error(error?.message || 'خطا در ثبت جلسه');
  } finally {
    setCommitting(false);
    commitLockRef.current = false;
  }
}
