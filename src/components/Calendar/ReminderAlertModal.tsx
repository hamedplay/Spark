import { Clock, MapPin } from 'lucide-react';
import type { MeetingData } from './types';

function ReminderAlertModal({ alert, onClose }: {
  alert: { meeting: MeetingData; minutesBefore: number };
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" dir="rtl">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-bounce-in">
        <div className="bg-amber-500 px-5 py-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0">
            <Clock className="w-5 h-5 text-white" />
          </div>
          <div>
            <p className="text-white font-bold text-sm">یادآوری جلسه</p>
            <p className="text-white/80 text-xs mt-0.5">
              {alert.minutesBefore >= 60
                ? `${alert.minutesBefore / 60} ساعت دیگر`
                : `${alert.minutesBefore} دقیقه دیگر`}
            </p>
          </div>
        </div>
        <div className="p-5">
          <p className="font-semibold text-gray-900 dark:text-white text-base">{alert.meeting.subject}</p>
          <div className="mt-2 space-y-1 text-sm text-gray-500 dark:text-gray-400">
            {alert.meeting.start_time && (
              <p className="flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" />{alert.meeting.start_time}{alert.meeting.end_time ? ` - ${alert.meeting.end_time}` : ''}</p>
            )}
            {alert.meeting.location && (
              <p className="flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5" />{alert.meeting.location}</p>
            )}
          </div>
          <button onClick={onClose} className="mt-4 w-full py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-sm font-medium transition-colors">
            باشه، متوجه شدم
          </button>
        </div>
      </div>
    </div>
  );
}

export { ReminderAlertModal };
