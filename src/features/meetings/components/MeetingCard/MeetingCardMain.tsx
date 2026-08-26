import { useState } from 'react';
import { Calendar as CalendarIcon } from 'lucide-react';
import { DeleteMeetingModal } from './DeleteMeetingModal';
import { MeetingDetails } from './MeetingDetails';
import { ParticipantStatusPanel } from './ParticipantStatusPanel';
import { MeetingShareDialog } from './MeetingShareDialog';
import { MeetingShareCard } from './MeetingShareCard';
import { MeetingCardHeader } from './MeetingCardHeader';
import type { Meeting } from '../../../../types';
import type { MeetingFormPrefillData } from '../../types/meetingForm';
import { resendRejectedMeetingAfterEdit } from '../../commands/resendRejectedMeetingAfterEdit';
import { getCurrentAuthUserId } from '../../../auth';
import { resendMeetingInvitations } from '../../commands/resendMeetingInvitations';
import { deleteMeetingPermanently } from '../../commands/deleteMeetingPermanently';
import { buildGoogleCalendarEventUrl } from '../../builders/buildGoogleCalendarEventUrl';
import { buildMeetingEditPrefill } from '../../builders/buildMeetingEditPrefill';
import toast from 'react-hot-toast';
import { ActionsSection } from './ActionsSection';
import { UserSelectorModal } from './UserSelectorModal';
import { CreateMeetingForm } from '../CreateMeetingForm';
import { useMeetingCardReadModel } from '../../hooks/useMeetingCardReadModel';
import { useMeetingCardSharing } from '../../hooks/useMeetingCardSharing';

interface MeetingCardMainProps {
  meeting: Meeting;
  onUpdate: () => void;
  onScheduleInCalendar?: (meeting: Meeting) => void;
}

export function MeetingCardMain({ meeting, onUpdate, onScheduleInCalendar }: MeetingCardMainProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editPrefill, setEditPrefill] = useState<MeetingFormPrefillData | null>(null);
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
    handleNativeShareImage,
    handleDownloadShareImage,
  } = useMeetingCardSharing({
    meeting,
    agendaItems,
    setLoading,
  });

  const handleResend = async () => {
    setLoading(true);
    try {
      const currentUserId = await getCurrentAuthUserId();
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
      const currentUserId = await getCurrentAuthUserId();

      await deleteMeetingPermanently({
        meetingId: meeting.id,
        meetingSubject: meeting.subject,
        participantUserIds: (meeting.participant_user_ids || []) as string[],
        notifyUserIds: (meeting.notify_users || []) as string[],
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

  const handleAddToGoogleCalendar = () => {
    try {
      const calendarUrl = buildGoogleCalendarEventUrl({ meeting, agendaItems });
      window.open(calendarUrl, '_blank');
    } catch {
      toast.error('خطا در ایجاد رویداد تقویم');
    }
  };

  if (isEditing) {
    const prefill = buildMeetingEditPrefill({
      meeting,
      override: editPrefill,
    });

    const handleEditFormSuccess = async () => {
      if (meeting.status_type === 'rejected') {
        try {
          const currentUserId = await getCurrentAuthUserId();

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
      <div className="rounded-2xl border border-slate-200 bg-white p-2 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <CreateMeetingForm
          onSuccess={handleEditFormSuccess}
          prefillData={prefill}
          onCancel={() => { setIsEditing(false); setEditPrefill(null); }}
        />
      </div>
    );
  }

  const statusSurface = meeting.status === 'archived'
    ? 'border-slate-200 bg-white/95 dark:border-slate-800 dark:bg-slate-900/90'
    : meeting.status_type === 'rejected'
      ? 'border-rose-200 bg-gradient-to-br from-white to-rose-50/50 ring-1 ring-rose-200/60 dark:border-rose-500/30 dark:from-slate-900 dark:to-rose-950/20 dark:ring-rose-400/20'
      : meeting.status_type === 'requested'
        ? 'border-amber-200 bg-gradient-to-br from-white to-amber-50/45 dark:border-amber-500/25 dark:from-slate-900 dark:to-amber-950/15'
        : 'border-emerald-100 bg-gradient-to-br from-white to-emerald-50/35 dark:border-emerald-500/20 dark:from-slate-900 dark:to-emerald-950/10';

  return (
    <article
      ref={cardRef}
      className={`relative flex flex-col overflow-visible rounded-2xl border p-3 shadow-[0_10px_28px_rgba(15,23,42,0.045)] transition-all hover:-translate-y-0.5 hover:shadow-[0_16px_36px_rgba(15,23,42,0.08)] dark:shadow-none sm:p-3.5 ${statusSurface}`}
    >
      {meeting.status === 'open' && meeting.status_type === 'rejected' && <span className="absolute inset-y-0 right-0 w-1 rounded-r-2xl bg-rose-500" />}
      {meeting.status === 'open' && meeting.status_type === 'requested' && <span className="absolute inset-y-0 right-0 w-1 rounded-r-2xl bg-amber-400" />}

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

      <div className="min-w-0">
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
        <div className="mt-2.5 border-t border-slate-200/80 pt-2.5 dark:border-slate-700/70">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              onClick={() => setShowActions(!showActions)}
              className="rounded-lg border border-violet-200 bg-violet-50 px-2.5 py-1.5 text-[10px] font-bold text-violet-700 transition-colors hover:bg-violet-100 dark:border-violet-500/25 dark:bg-violet-500/10 dark:text-violet-300 dark:hover:bg-violet-500/20"
              title={showActions ? 'پنهان‌کردن اقدامات' : 'نمایش و افزودن اقدامات'}
            >
              {showActions ? 'بستن اقدامات' : 'اقدامات'}
            </button>

            {meeting.status_type === 'approved' && onScheduleInCalendar && (
              <button
                onClick={() => onScheduleInCalendar(meeting)}
                className="flex items-center gap-1.5 rounded-lg bg-gradient-to-l from-emerald-500 to-teal-500 px-2.5 py-1.5 text-[10px] font-bold text-white shadow-[0_5px_14px_rgba(16,185,129,0.16)] transition hover:from-emerald-400 hover:to-teal-400"
                title="برنامه‌ریزی در تقویم"
              >
                <CalendarIcon className="h-3.5 w-3.5" />
                <span>تقویم</span>
              </button>
            )}
          </div>
          {showActions && (
            <div className="mt-2.5">
              <ActionsSection meetingId={meeting.id} actions={meeting.actions} onUpdate={onUpdate} />
            </div>
          )}
        </div>
      )}

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
          onShare={handleNativeShareImage}
          onDownload={handleDownloadShareImage}
        />
      )}

      <MeetingShareCard ref={shareCardRef} meeting={meeting} agendaItems={agendaItems} />
    </article>
  );
}
