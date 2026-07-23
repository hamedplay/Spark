import React, { useState } from 'react';
import { Calendar as CalendarIcon } from 'lucide-react';
import { DeleteMeetingModal } from './DeleteMeetingModal';
import { MeetingDetails } from './MeetingDetails';
import { ParticipantStatusPanel } from './ParticipantStatusPanel';
import { MeetingShareDialog } from './MeetingShareDialog';
import { MeetingShareCard } from './MeetingShareCard';
import { MeetingCardHeader } from './MeetingCardHeader';import { Meeting } from '../../../../types';
import { supabase } from '../../../../lib/supabase';
import { insertNotification } from '../../../../lib/notifications';
import { getMeetingTemplateKey } from '../../../../config/templateCatalog';
import toast from 'react-hot-toast';
import { ActionsSection } from './ActionsSection';
import { UserSelectorModal } from './UserSelectorModal';
import { CreateMeetingForm } from '../CreateMeetingForm';
import { useMeetingCardReadModel } from '../../hooks/useMeetingCardReadModel';
import { useMeetingCardSharing } from '../../hooks/useMeetingCardSharing';
import moment from 'moment-jalaali';

interface MeetingCardMainProps {
  meeting: Meeting;
  onUpdate: () => void;
  onScheduleInCalendar?: (meeting: Meeting) => void;
}

// ─── MeetingCardMain ──────────────────────────────────────────────────────────
export function MeetingCardMain({ meeting, onUpdate, onScheduleInCalendar }: MeetingCardMainProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editPrefill, setEditPrefill] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [showActions, setShowActions] = useState(false);
  const [showUserSelector, setShowUserSelector] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  const {
    agendaItems,
    participantUserIds,
    participantStatuses,
    delegateNames,
    isCreator,
  } = useMeetingCardReadModel(meeting);

  const {
    cardRef,
    shareCardRef,
    shareMenuRef,
    showShareMenu,
    showShareDialog,
    shareImageUrl,
    toggleShareMenu,
    closeShareDialog,
    handleShareImage,
    handleShareText,
    handleSendToTelegram,
    handleDownloadShareImage,
  } = useMeetingCardSharing({
    meeting,
    agendaItems,
    setLoading,
  });

  const handleResend = async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Reset declined inbox entries to pending and clear the rejected flag (via SECURITY DEFINER)
      const { error } = await supabase.rpc('resend_meeting_invitations', { p_meeting_id: meeting.id });
      if (error) throw error;

      // Notify participants who had declined
      const { data: declinedRows } = await supabase
        .from('meeting_inbox')
        .select('user_id')
        .eq('meeting_id', meeting.id)
        .eq('status', 'pending'); // freshly reset to pending

      const notifyIds = (declinedRows || []).map((r: any) => r.user_id);
      if (notifyIds.length > 0) {
        const { data: notifyProfiles } = await supabase.from('profiles').select('user_id, full_name').in('user_id', notifyIds);
        const nameMap: Record<string, string> = {};
        for (const p of (notifyProfiles || [])) nameMap[p.user_id] = p.full_name || '';
        await Promise.all(notifyIds.map((uid: string) =>
          insertNotification({
            userId: uid,
            category: 'meeting',
            eventType: getMeetingTemplateKey('participant', 'invite'),
            audience: 'participants',
            fallbackTitle: `دعوت مجدد به جلسه: ${meeting.subject}`,
            fallbackMessage: `شما مجدداً به جلسه «${meeting.subject}» دعوت شده‌اید`,
            placeholders: { meeting_subject: meeting.subject, full_name: nameMap[uid] || '', recipient_greeting: nameMap[uid] ? `${nameMap[uid]} گرامی` : 'همکار گرامی' },
            senderId: user.id,
            actionUrl: 'meetings',
          })
        ));
      }

      toast.success('دعوت‌نامه مجدداً برای شرکت‌کنندگان ارسال شد');
      onUpdate();
    } catch {
      toast.error('خطا در ارسال مجدد دعوت‌نامه');
    } finally {
      setLoading(false);
    }
  };

  const handlePermanentDelete = async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      // Notify participants before deleting
      const pIds = (meeting.participant_user_ids || []) as string[];
      const notifyIds = [...pIds, ...((meeting.notify_users || []) as string[])].filter(uid => uid !== user?.id);
      if (notifyIds.length) {
        const { data: cancelProfiles } = await supabase.from('profiles').select('user_id, full_name').in('user_id', notifyIds);
        const cancelNameMap: Record<string, string> = {};
        for (const p of (cancelProfiles || [])) cancelNameMap[p.user_id] = p.full_name || '';
        await Promise.all(notifyIds.map(uid =>
          insertNotification({
            userId: uid,
            category: 'meeting',
            eventType: getMeetingTemplateKey(pIds.includes(uid) ? 'participant' : 'observer', 'cancel'),
            audience: pIds.includes(uid) ? 'participants' : 'observers',
            fallbackTitle: 'جلسه لغو شد',
            fallbackMessage: `جلسه «${meeting.subject}» لغو شده است`,
            placeholders: { meeting_subject: meeting.subject, full_name: cancelNameMap[uid] || '', recipient_greeting: cancelNameMap[uid] ? `${cancelNameMap[uid]} گرامی` : 'همکار گرامی' },
            senderId: user?.id ?? null,
            actionUrl: 'meetings',
          })
        ));
      }
      await supabase.from('meeting_inbox').delete().eq('meeting_id', meeting.id);
      const { error } = await supabase.from('meetings').delete().eq('id', meeting.id);
      if (error) throw error;
      toast.success('جلسه به طور کامل حذف شد');
      onUpdate();
    } catch {
      toast.error('خطا در حذف جلسه');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteAndRevert = async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('unauthenticated');

      // Fetch the full meeting data before deleting
      const { data: fullMtg } = await supabase
        .from('meetings')
        .select('subject, location, representative, phone, notes, priority, participant_user_ids, notify_users, external_participants, meeting_manager')
        .eq('id', meeting.id)
        .maybeSingle();
      if (!fullMtg) throw new Error('جلسه یافت نشد');

      // Fetch participants and actions to copy
      const { data: oldParticipants } = await supabase
        .from('participants')
        .select('name')
        .eq('meeting_id', meeting.id);
      const { data: oldActions } = await supabase
        .from('actions')
        .select('title, status, assignee')
        .eq('meeting_id', meeting.id);

      // Create new meeting record with scheduling fields nulled out
      const { data: newMtg, error: insertErr } = await supabase
        .from('meetings')
        .insert([{
          subject: fullMtg.subject,
          location: fullMtg.location ?? null,
          representative: fullMtg.representative ?? null,
          phone: fullMtg.phone ?? null,
          notes: fullMtg.notes ?? null,
          priority: fullMtg.priority,
          participant_user_ids: fullMtg.participant_user_ids ?? [],
          notify_users: fullMtg.notify_users ?? [],
          external_participants: fullMtg.external_participants ?? [],
          meeting_manager: fullMtg.meeting_manager ?? null,
          user_id: user.id,
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
        }])
        .select('id')
        .single();
      if (insertErr) throw insertErr;

      const newId = newMtg.id;

      // Copy participants table rows
      if ((oldParticipants ?? []).length > 0) {
        await supabase.from('participants').insert(
          (oldParticipants!).map(p => ({ meeting_id: newId, name: p.name }))
        );
      }

      // Copy actions table rows
      if ((oldActions ?? []).length > 0) {
        await supabase.from('actions').insert(
          (oldActions!).map(a => ({ meeting_id: newId, title: a.title, status: a.status, assignee: a.assignee }))
        );
      }

      // Notify participants that the scheduled meeting was cancelled (new unscheduled request will be created)
      const pIds = (fullMtg.participant_user_ids || []) as string[];
      const notifyIds = [...pIds, ...((fullMtg.notify_users || []) as string[])].filter(uid => uid !== user.id);
      if (notifyIds.length) {
        const { data: cancelProfiles2 } = await supabase.from('profiles').select('user_id, full_name').in('user_id', notifyIds);
        const cancelNameMap2: Record<string, string> = {};
        for (const p of (cancelProfiles2 || [])) cancelNameMap2[p.user_id] = p.full_name || '';
        await Promise.all(notifyIds.map(uid =>
          insertNotification({
            userId: uid,
            category: 'meeting',
            eventType: getMeetingTemplateKey(pIds.includes(uid) ? 'participant' : 'observer', 'cancel'),
            audience: pIds.includes(uid) ? 'participants' : 'observers',
            fallbackTitle: 'جلسه لغو شد',
            fallbackMessage: `جلسه «${fullMtg.subject}» لغو شده است`,
            placeholders: { meeting_subject: fullMtg.subject, full_name: cancelNameMap2[uid] || '', recipient_greeting: cancelNameMap2[uid] ? `${cancelNameMap2[uid]} گرامی` : 'همکار گرامی' },
            senderId: user.id,
            actionUrl: 'meetings',
          })
        ));
      }

      // Delete old meeting_inbox entries then the meeting itself
      await supabase.from('meeting_inbox').delete().eq('meeting_id', meeting.id);
      const { error: delErr } = await supabase.from('meetings').delete().eq('id', meeting.id);
      if (delErr) throw delErr;

      toast.success('جلسه حذف شد و درخواست جدید ایجاد گردید');
      onUpdate();
    } catch (err: any) {
      toast.error(err?.message || 'خطا در حذف و بازگشت جلسه');
    } finally {
      setLoading(false);
    }
  };

  const handleAddToGoogleCalendar = () => {
    try {
      const startDate = new Date(meeting.requestDate);
      const durationInMinutes = parseInt(meeting.duration) || 60;
      const endDate = new Date(startDate.getTime() + durationInMinutes * 60000);
      const details = [
        `نماینده: ${meeting.representative}`,
        `شماره تماس: ${meeting.phone}`,
        `شرکت‌کنندگان: ${meeting.participants.join('، ')}`,
        meeting.notes ? `یادداشت‌ها: ${meeting.notes}` : '',
        agendaItems.length > 0
          ? `دستور جلسه:\n` + agendaItems.map((item, idx) => {
              const parts = [`${idx + 1}. ${item.title}`];
              if (item.presenter) parts.push(`ارائه‌دهنده: ${item.presenter}`);
              if (item.duration_minutes) parts.push(`${item.duration_minutes} دقیقه`);
              return parts.join(' | ');
            }).join('\n')
          : ''
      ].filter(Boolean).join('\n');
      const params = new URLSearchParams({
        action: 'TEMPLATE', text: meeting.subject, details, location: meeting.location,
        dates: `${startDate.toISOString().replace(/(-|:|\.)/g, '')}/${endDate.toISOString().replace(/(-|:|\.)/g, '')}`,
        ctz: 'Asia/Tehran', add: (meeting.guest_emails || []).join(',')
      });
      window.open(`https://calendar.google.com/calendar/render?${params.toString()}`, '_blank');
    } catch {
      toast.error('خطا در ایجاد رویداد تقویم');
    }
  };

  if (isEditing) {
    const meetingJalaaliDate = (() => {
      if (!editPrefill) {
        const src = (meeting as any).request_jalaali_date;
        if (src) return src;
        if (meeting.requestDate) {
          const m = moment(meeting.requestDate);
          if (m.isValid()) return `${m.jYear()}/${String(m.jMonth() + 1).padStart(2, '0')}/${String(m.jDate()).padStart(2, '0')}`;
        }
      }
      return '';
    })();
    const prefill = editPrefill || {
      subject: meeting.subject,
      location: meeting.location,
      representative: meeting.representative,
      phone: meeting.phone,
      notes: meeting.notes || '',
      priority: meeting.priority,
      meetingId: meeting.id,
      startTime: meeting.start_time || '',
      endTime: meeting.end_time || '',
      requestJalaaliDate: meetingJalaaliDate,
    };

    const handleEditFormSuccess = async () => {
      if (meeting.status_type === 'rejected') {
        // Edit from a rejected-meeting state: reset declined entries and resend
        try {
          const { data: { user } } = await supabase.auth.getUser();
          if (user) {
            await supabase.rpc('resend_meeting_invitations', { p_meeting_id: meeting.id });
            const { data: savedMtg } = await supabase
              .from('meetings')
              .select('participant_user_ids')
              .eq('id', meeting.id)
              .maybeSingle();
            const participantIds: string[] = (savedMtg?.participant_user_ids ?? []).filter((uid: string) => uid !== user.id);
            if (participantIds.length > 0) {
              const { data: reInviteProfiles } = await supabase.from('profiles').select('user_id, full_name').in('user_id', participantIds);
              const reInviteNameMap: Record<string, string> = {};
              for (const p of (reInviteProfiles || [])) reInviteNameMap[p.user_id] = p.full_name || '';
              await Promise.all(participantIds.map(uid =>
                insertNotification({
                  userId: uid,
                  category: 'meeting',
                  eventType: getMeetingTemplateKey('participant', 'invite'),
                  audience: 'participants',
                  fallbackTitle: `دعوت مجدد به جلسه: ${meeting.subject}`,
                  fallbackMessage: `جلسه «${meeting.subject}» ویرایش شد و مجدداً برای شما ارسال گردید`,
                  placeholders: { meeting_subject: meeting.subject, full_name: reInviteNameMap[uid] || '', recipient_greeting: reInviteNameMap[uid] ? `${reInviteNameMap[uid]} گرامی` : 'همکار گرامی' },
                  senderId: user.id,
                  actionUrl: 'meetings',
                })
              ));
            }
            toast.success('جلسه ویرایش شد و مجدداً برای شرکت‌کنندگان ارسال گردید');
          }
        } catch {
          toast.error('خطا در ارسال مجدد');
        }
      }
      setIsEditing(false);
      setEditPrefill(null);
      onUpdate();
    };

    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-2">
        <CreateMeetingForm
          onSuccess={handleEditFormSuccess}
          prefillData={prefill}
          onCancel={() => { setIsEditing(false); setEditPrefill(null); }}
        />
      </div>
    );
  }

  return (
    <div ref={cardRef} className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow flex flex-col min-h-[500px]">
      <MeetingCardHeader
        meeting={meeting}
        loading={loading}
        showShareMenu={showShareMenu}
        shareMenuRef={shareMenuRef}
        canAddToGoogleCalendar={Boolean(onScheduleInCalendar)}
        onResend={handleResend}
        onEdit={() => setIsEditing(true)}
        onEditAndResend={() => setIsEditing(true)}
        onOpenUserSelector={() => setShowUserSelector(true)}
        onToggleShareMenu={toggleShareMenu}
        onShareImage={handleShareImage}
        onShareText={handleShareText}
        onSendToTelegram={handleSendToTelegram}
        onAddToGoogleCalendar={handleAddToGoogleCalendar}
        onDelete={() => setShowDeleteModal(true)}
      />

      <div className="flex-1">
        <MeetingDetails meeting={meeting} agendaItems={agendaItems} />

        <ParticipantStatusPanel
          meeting={meeting}
          participantUserIds={participantUserIds}
          participantStatuses={participantStatuses}
          delegateNames={delegateNames}
          isCreator={isCreator}
        />
      </div>

      {meeting.status === 'open' && (
        <div className="mt-auto pt-4 border-t border-gray-200 dark:border-gray-700">
          <div className="flex justify-between items-center">
            <button
              onClick={() => setShowActions(!showActions)}
              className="text-blue-500 dark:text-blue-400 hover:text-blue-600 dark:hover:text-blue-300 text-sm font-medium"
            >
              {showActions ? 'پنهان کردن اقدامات' : 'نمایش/افزودن اقدامات'}
            </button>
            {meeting.status_type === 'approved' && onScheduleInCalendar && (
              <button
                onClick={() => onScheduleInCalendar(meeting)}
                className="flex items-center gap-2 bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded-lg transition-colors"
                title="برنامه‌ریزی در تقویم"
              >
                <CalendarIcon className="w-5 h-5" />
                <span className="text-sm">برنامه‌ریزی در تقویم</span>
              </button>
            )}
          </div>
          {showActions && (
            <ActionsSection meetingId={meeting.id} actions={meeting.actions} onUpdate={onUpdate} />
          )}
        </div>
      )}

      {/* Modals */}
      {showDeleteModal && (
        <DeleteMeetingModal
          meeting={meeting}
          onClose={() => setShowDeleteModal(false)}
          onPermanentDelete={handlePermanentDelete}
          loading={loading}
        />
      )}

      {showUserSelector && (
        <UserSelectorModal
          meetingId={meeting.id}
          onClose={() => setShowUserSelector(false)}
          onSuccess={() => {
            setShowUserSelector(false);
            toast.success('درخواست جلسه با موفقیت ارسال شد');
          }}
        />
      )}

      {showShareDialog && shareImageUrl && (
        <MeetingShareDialog
          imageUrl={shareImageUrl}
          onClose={closeShareDialog}
          onDownload={handleDownloadShareImage}
        />
      )}

      {/* Hidden share card for image generation */}
      <MeetingShareCard ref={shareCardRef} meeting={meeting} agendaItems={agendaItems} />
    </div>
  );
}