export class MeetingCreationRecoveryError extends Error {}

interface NewMeetingDetailSteps {
  meetingId: string;
  saveParticipants: () => Promise<void>;
  saveAgenda: () => Promise<void>;
  rollback: () => Promise<void>;
}

/** Finish a newly inserted meeting before any notifications are dispatched.
 * This is compensating cleanup, not an atomic database transaction.
 */
export async function saveNewMeetingDetails(steps: NewMeetingDetailSteps): Promise<void> {
  try {
    await steps.saveParticipants();
    await steps.saveAgenda();
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'خطا در ثبت جزئیات جلسه';
    try {
      await steps.rollback();
    } catch {
      throw new MeetingCreationRecoveryError(
        `${reason}. پاک‌سازی جلسه ناقص تأیید نشد. برای جلوگیری از ثبت تکراری، دوباره ثبت نکنید و وضعیت جلسه ${steps.meetingId} را بررسی کنید.`,
      );
    }
    throw new Error(`${reason}. ثبت جلسه لغو شد و جلسه تازه ایجادشده حذف شد؛ پس از رفع خطا دوباره تلاش کنید.`);
  }
}
