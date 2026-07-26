import { CalendarMeetingForm } from '../CalendarMeetingForm';
import type { CalendarEntry } from './types';
import type { MeetingData } from './types';

function MeetingFormDrawer({
  prefillData, calendars, subscribedCalendars,
  onCancel, onSuccess,
}: {
  prefillData: any;
  calendars: CalendarEntry[];
  subscribedCalendars: CalendarEntry[];
  onCancel: () => void;
  onSuccess: (subject: string, isUpdate: boolean) => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50" onClick={onCancel}>
      <div
        className="absolute inset-y-0 left-0 w-full max-w-lg bg-white dark:bg-gray-900 shadow-2xl flex flex-col animate-slideInLeft"
        style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
        onClick={e => e.stopPropagation()}
      >
        <CalendarMeetingForm
          prefillData={prefillData}
          calendars={[...calendars.filter(c => !c.is_occasions && c.type !== 'private'), ...subscribedCalendars.filter(c => !c.is_occasions && c.type !== 'private')]}
          onCancel={onCancel}
          onSuccess={onSuccess}
        />
      </div>
    </div>
  );
}

export { MeetingFormDrawer };
