import React, { useState } from 'react';
import { Calendar as CalendarIcon } from 'lucide-react';
import { DeleteMeetingModal } from './DeleteMeetingModal';
import { MeetingDetails } from './MeetingDetails';
import { ParticipantStatusPanel } from './ParticipantStatusPanel';
import { MeetingShareDialog } from './MeetingShareDialog';
import { MeetingShareCard } from './MeetingShareCard';
import { MeetingCardHeader } from './MeetingCardHeader';import { Meeting } from '../../../../types';
import { resendRejectedMeetingAfterEdit } from '../../commands/resendRejectedMeetingAfterEdit';
import { getCurrentAuthUserId } from '../../../auth';
import { resendMeetingInvitations } from '../../commands/resendMeetingInvitations';
import { deleteMeetingPermanently } from '../../commands/deleteMeetingPermanently';
import { deleteAndRevertMeeting } from '../../commands/deleteAndRevertMeeting';
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
      const currentUserId =
        await getCurrentAuthUserId();
      if (!currentUserId) return;

      await resendMeetingInvitations({
        meetingId: meeting.id,
        meetingSubject: meeting.subject,
        senderId: currentUserId,
      });

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
      const currentUserId =
        await getCurrentAuthUserId();

      await deleteMeetingPermanently({
        meetingId: meeting.id,
        meetingSubject: meeting.subject,

        participantUserIds:
          (
            meeting.participant_user_ids ||
            []
          ) as string[],

        notifyUserIds:
          (
            meeting.notify_users ||
            []
          ) as string[],

        senderId: currentUserId,
      });

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
      const currentUserId =
        await getCurrentAuthUserId();

      if (!currentUserId) {
        throw new Error('unauthenticated');
      }

      await deleteAndRevertMeeting({
        meetingId: meeting.id,
        currentUserId,
      });

      toast.success('جلسه حذف شد و درخواست جدید ایجاد گردید');
      onUpdate();
    } catch (error: unknown) {
      const message =
        typeof error === 'object' &&
        error !== null &&
        'message' in error &&
        typeof error.message === 'string'
          ? error.message
          : undefined;

      toast.error(
        message || 'خطا در حذف و بازگشت جلسه'
      );
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
        try {
          const currentUserId =
            await getCurrentAuthUserId();

          if (currentUserId) {
            await resendRejectedMeetingAfterEdit({
              meetingId: meeting.id,
              meetingSubject: meeting.subject,
              senderId: currentUserId,
            });

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