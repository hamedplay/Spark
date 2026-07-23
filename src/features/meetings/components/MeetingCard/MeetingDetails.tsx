import { Calendar as CalendarIcon, Clock, MapPin, User, Phone, ClipboardList, UserCheck } from 'lucide-react';
import { Meeting } from '../../../../types';
import type { AgendaItem } from '../../../../types';

interface MeetingDetailsProps {
  meeting: Meeting;
  agendaItems: AgendaItem[];
}

export function MeetingDetails({ meeting, agendaItems }: MeetingDetailsProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center text-gray-600 dark:text-gray-300">
        <CalendarIcon className="w-5 h-5 ml-2 flex-shrink-0" />
        <span>{new Date(meeting.requestDate).toLocaleDateString('fa-IR')}</span>
      </div>
      <div className="flex items-center text-gray-600 dark:text-gray-300">
        <Clock className="w-5 h-5 ml-2 flex-shrink-0" />
        {meeting.start_time && meeting.end_time
          ? <span>{meeting.start_time} - {meeting.end_time}</span>
          : <span>{meeting.duration}</span>}
      </div>
      <div className="flex items-center text-gray-600 dark:text-gray-300">
        <MapPin className="w-5 h-5 ml-2 flex-shrink-0" />
        <span>{meeting.location}</span>
      </div>
      <div className="flex items-center text-gray-600 dark:text-gray-300">
        <User className="w-5 h-5 ml-2 flex-shrink-0" />
        <span>{meeting.representative}</span>
      </div>
      <div className="flex items-center text-gray-600 dark:text-gray-300">
        <Phone className="w-5 h-5 ml-2 flex-shrink-0" />
        <span>{meeting.phone}</span>
      </div>
      {meeting.notes && (
        <div className="mt-4 text-gray-600 dark:text-gray-300">
          <p className="whitespace-pre-wrap">{meeting.notes}</p>
        </div>
      )}

      {/* Agenda items */}
      {agendaItems.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2 flex items-center gap-1.5">
            <ClipboardList className="w-3.5 h-3.5" /> دستور جلسه
          </p>
          <div className="space-y-1.5">
            {agendaItems.map((item, idx) => (
              <div key={item.id} className="flex items-start gap-2 p-2 bg-gray-50 dark:bg-gray-700/50 rounded-lg border border-gray-100 dark:border-gray-700 text-sm">
                <span className="w-5 h-5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 text-xs flex items-center justify-center font-bold flex-shrink-0 mt-0.5">
                  {idx + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-800 dark:text-white">{item.title}</p>
                  <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400 mt-0.5 flex-wrap">
                    {item.presenter && <span className="flex items-center gap-1"><UserCheck className="w-3 h-3" />{item.presenter}</span>}
                    {item.duration_minutes != null && <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{item.duration_minutes} دقیقه</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
