import React from 'react';
import { GitBranch, X, CircleCheck as CheckCircle, Archive, Share2, Calendar, Users, Circle } from 'lucide-react';
import { type MeetingRow, type MeetingFlowEvent, type Profile, toJalaliTime } from '../SystemMonitoringPage';

export function MeetingFlowModal({ meeting, profiles, onClose }: {
  meeting: MeetingRow; profiles: Profile[]; onClose: () => void;
}) {
  const getProfile = (uid: string | null) => uid ? (profiles.find(p => p.user_id === uid)?.full_name || uid.slice(0, 8)) : null;

  const events: MeetingFlowEvent[] = [
    { label: 'ایجاد درخواست', date: meeting.created_at, actor: getProfile(meeting.user_id), icon: Circle, color: 'bg-blue-500', done: true },
    { label: 'تایید جلسه', date: meeting.status_type === 'approved' ? meeting.request_date : null, actor: null, icon: CheckCircle, color: meeting.status_type === 'approved' ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600', done: meeting.status_type === 'approved' },
    { label: 'تنظیم زمان جلسه', date: meeting.start_time, actor: null, icon: Calendar, color: meeting.start_time ? 'bg-teal-500' : 'bg-gray-300 dark:bg-gray-600', done: !!meeting.start_time },
    { label: 'بایگانی / بسته شدن', date: meeting.status === 'closed' ? meeting.created_at : null, actor: null, icon: Archive, color: meeting.status === 'closed' ? 'bg-gray-500' : 'bg-gray-300 dark:bg-gray-600', done: meeting.status === 'closed' },
  ];

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4" dir="rtl">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-teal-100 dark:bg-teal-900/30 flex items-center justify-center">
              <GitBranch className="w-5 h-5 text-teal-600 dark:text-teal-400" />
            </div>
            <div>
              <h3 className="font-bold text-gray-900 dark:text-white text-sm">فلوچارت جلسه</h3>
              <p className="text-xs text-gray-400 truncate max-w-xs">{meeting.subject}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors text-gray-400"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-0">
          {events.map((ev, i) => {
            const Icon = ev.icon;
            return (
              <div key={i} className="flex gap-4">
                <div className="flex flex-col items-center">
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${ev.done ? ev.color : 'bg-gray-200 dark:bg-gray-700'}`}>
                    <Icon className={`w-4 h-4 ${ev.done ? 'text-white' : 'text-gray-400 dark:text-gray-500'}`} />
                  </div>
                  {i < events.length - 1 && <div className={`w-0.5 flex-1 my-1 rounded-full ${ev.done ? 'bg-teal-300 dark:bg-teal-700' : 'bg-gray-200 dark:bg-gray-700'}`} style={{ minHeight: '32px' }} />}
                </div>
                <div className={`pb-5 flex-1 ${i === events.length - 1 ? 'pb-0' : ''}`}>
                  <p className={`font-semibold text-sm ${ev.done ? 'text-gray-900 dark:text-white' : 'text-gray-400 dark:text-gray-500'}`}>{ev.label}</p>
                  {ev.date && <p className="text-xs text-gray-500 mt-0.5">{toJalaliTime(ev.date)}</p>}
                  {ev.actor && <p className="text-xs text-blue-500 mt-0.5">توسط: {ev.actor}</p>}
                  {!ev.done && <p className="text-xs text-gray-400 mt-0.5 italic">انجام نشده</p>}
                </div>
              </div>
            );
          })}
        </div>
        <div className="border-t border-gray-100 dark:border-gray-700 px-5 py-4 space-y-3">
          <div className="flex items-center gap-2">
            <Share2 className="w-4 h-4 text-blue-400" />
            <span className="text-sm text-gray-700 dark:text-gray-300">اشتراک‌گذاری:
              <span className={`mr-1 font-bold ${(meeting.shared_count || 0) > 0 ? 'text-blue-500' : 'text-gray-400'}`}>
                {(meeting.shared_count || 0) > 0 ? `${meeting.shared_count} بار` : 'انجام نشده'}
              </span>
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-teal-400" />
            <span className="text-sm text-gray-700 dark:text-gray-300">شرکت‌کنندگان: <span className="font-bold text-teal-600 dark:text-teal-400 mr-1">{meeting.participants?.length || 0} نفر</span></span>
          </div>
          {meeting.participants && meeting.participants.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pr-6">
              {meeting.participants.map(p => <span key={p.id} className="px-2 py-0.5 bg-teal-50 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300 rounded-full text-xs">{p.name}</span>)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
