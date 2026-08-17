import { Calendar as CalendarIcon, Clock, MapPin, User, Phone, ClipboardList, UserCheck, ChevronDown, StickyNote } from 'lucide-react';
import { Meeting } from '../../../../types';
import type { AgendaItem } from '../../../../types';

interface MeetingDetailsProps {
  meeting: Meeting;
  agendaItems: AgendaItem[];
}

export function MeetingDetails({ meeting, agendaItems }: MeetingDetailsProps) {
  const coreDetails = [
    {
      key: 'date',
      Icon: CalendarIcon,
      value: new Date(meeting.requestDate).toLocaleDateString('fa-IR'),
    },
    {
      key: 'time',
      Icon: Clock,
      value: meeting.start_time && meeting.end_time
        ? `${meeting.start_time} - ${meeting.end_time}`
        : meeting.duration,
    },
    { key: 'location', Icon: MapPin, value: meeting.location || '—' },
    { key: 'representative', Icon: User, value: meeting.representative || '—' },
    { key: 'phone', Icon: Phone, value: meeting.phone || '—' },
  ];

  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-2 gap-x-3 gap-y-2 rounded-xl border border-slate-100/90 bg-white/65 p-2.5 dark:border-slate-800 dark:bg-slate-950/25">
        {coreDetails.map(({ key, Icon, value }) => (
          <div
            key={key}
            className={`flex min-w-0 items-center gap-1.5 text-[11px] leading-5 text-slate-600 dark:text-slate-300 ${key === 'phone' ? 'col-span-2 sm:col-span-1' : ''}`}
            title={String(value)}
          >
            <Icon className="h-3.5 w-3.5 flex-shrink-0 text-slate-400 dark:text-slate-500" />
            <span className="truncate">{value}</span>
          </div>
        ))}
      </div>

      {meeting.notes && (
        <details className="group rounded-xl border border-slate-100 bg-white/55 px-2.5 py-2 dark:border-slate-800 dark:bg-slate-950/20">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-[11px] font-bold text-slate-600 dark:text-slate-300">
            <span className="flex items-center gap-1.5">
              <StickyNote className="h-3.5 w-3.5 text-violet-500 dark:text-violet-300" />
              یادداشت جلسه
            </span>
            <ChevronDown className="h-3.5 w-3.5 text-slate-400 transition-transform group-open:rotate-180" />
          </summary>
          <p className="mt-2 whitespace-pre-wrap text-[11px] leading-5 text-slate-500 dark:text-slate-400">{meeting.notes}</p>
        </details>
      )}

      {agendaItems.length > 0 && (
        <details className="group rounded-xl border border-slate-100 bg-white/55 px-2.5 py-2 dark:border-slate-800 dark:bg-slate-950/20">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-[11px] font-bold text-slate-600 dark:text-slate-300">
            <span className="flex items-center gap-1.5">
              <ClipboardList className="h-3.5 w-3.5 text-cyan-600 dark:text-cyan-300" />
              دستور جلسه
              <span className="rounded-full bg-cyan-50 px-1.5 py-0.5 text-[9px] text-cyan-700 dark:bg-cyan-500/10 dark:text-cyan-300">
                {agendaItems.length.toLocaleString('fa-IR')}
              </span>
            </span>
            <ChevronDown className="h-3.5 w-3.5 text-slate-400 transition-transform group-open:rotate-180" />
          </summary>

          <div className="mt-2 space-y-1.5">
            {agendaItems.map((item, idx) => (
              <div key={item.id} className="flex items-start gap-2 rounded-lg bg-slate-50/80 p-2 dark:bg-slate-800/55">
                <span className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-cyan-100 text-[10px] font-bold text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-300">
                  {idx + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-1 text-[11px] font-bold text-slate-700 dark:text-slate-200">{item.title}</p>
                  {(item.presenter || item.duration_minutes != null) && (
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[9px] text-slate-400 dark:text-slate-500">
                      {item.presenter && <span className="flex min-w-0 items-center gap-1"><UserCheck className="h-3 w-3 flex-shrink-0" /><span className="truncate">{item.presenter}</span></span>}
                      {item.duration_minutes != null && <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{item.duration_minutes.toLocaleString('fa-IR')} دقیقه</span>}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
