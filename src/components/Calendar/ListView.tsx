import React from 'react';
import { Clock, MapPin, ChevronRight, Calendar, Users } from 'lucide-react';
import { JALAALI_WEEKDAYS, JALAALI_MONTHS, jalaaliToDate, jsDayToWeekday } from './utils';
import type { CalendarViewProps } from './viewShared';

export function ListView(p: CalendarViewProps) {
  const { listMeetings, listScrollRef, isToday, getMeetingColor, toFarsiTime, resolveName, currentUserId, expandedMeetingId, setExpandedMeetingId, handleEditMeeting } = p;

  return (
    <div ref={listScrollRef} className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-900 p-4 mx-3 mb-3 mt-1 border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm">
      {listMeetings.length === 0 ? (
        <div className="text-center py-16 text-gray-400"><Calendar className="w-12 h-12 mx-auto mb-3 opacity-30" /><p>جلسه‌ای وجود ندارد</p></div>
      ) : listMeetings.map(group => (
        <div key={group.date} {...(isToday(group.jy, group.jm, group.jd) ? { 'data-today': 'true' } : {})} className="mb-4">
          <div className="flex items-center gap-3 mb-2 sticky top-0 bg-gray-50 dark:bg-gray-900 py-1 z-10">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-lg flex-shrink-0 ${isToday(group.jy, group.jm, group.jd) ? 'bg-blue-500 text-white' : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-white border border-gray-200 dark:border-gray-600'}`}>{group.jd}</div>
            <div>
              <p className="text-sm font-semibold dark:text-white">{JALAALI_WEEKDAYS[jsDayToWeekday(jalaaliToDate(group.jy, group.jm, group.jd).getDay())]}</p>
              <p className="text-xs text-gray-400">{JALAALI_MONTHS[group.jm - 1]} {group.jy}</p>
            </div>
          </div>
          <div className="space-y-2">
            {group.meetings.map(m => {
              const c = getMeetingColor(m);
              const isExp = expandedMeetingId === m.id;
              const canEditM = m.user_id === currentUserId || m.meeting_manager === currentUserId;
              const participantIds = m.participant_user_ids || [];
              const notifyIds = (m.notify_users || []) as string[];
              const externalList = m.external_participants || [];
              const getNameById = (id: string) => resolveName(id);
              return (
                <div key={m.id} className="bg-white dark:bg-gray-800 rounded-2xl overflow-hidden border border-gray-100 dark:border-gray-700 shadow-sm hover:shadow-md transition-shadow">
                  <button className="w-full text-right px-4 py-3.5 flex items-center gap-3" onClick={() => setExpandedMeetingId(isExp ? null : m.id)}>
                    <div className="w-1.5 self-stretch rounded-full flex-shrink-0" style={{ backgroundColor: c }} />
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-sm dark:text-white truncate">{m.subject}</p>
                      <div className="flex flex-wrap gap-3 mt-1 text-xs text-gray-500 dark:text-gray-400">
                        {m.start_time && m.end_time && (
                          <span className="flex items-center gap-1 font-medium text-gray-700 dark:text-gray-300">
                            <Clock className="w-3 h-3 text-gray-400" />{toFarsiTime(m.start_time)} – {toFarsiTime(m.end_time)}
                          </span>
                        )}
                        {m.location && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{m.location}</span>}
                      </div>
                    </div>
                    <ChevronRight className={`w-4 h-4 text-gray-300 flex-shrink-0 transition-transform duration-200 ${isExp ? '-rotate-90' : ''}`} />
                  </button>
                  {isExp && (
                    <div className="border-t border-gray-100 dark:border-gray-700">
                      <div className="px-5 py-4 space-y-4">
                        {m.representative && (
                          <div className="flex items-start gap-3">
                            <div className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-gray-700 flex items-center justify-center flex-shrink-0">
                              <svg className="w-4 h-4 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 1 0-16 0"/></svg>
                            </div>
                            <div>
                              <p className="text-[11px] text-gray-400 font-medium mb-0.5">نماینده</p>
                              <p className="text-sm font-medium dark:text-white">{m.representative}</p>
                              {m.phone && <a href={`tel:${m.phone}`} className="text-xs text-blue-500 mt-0.5 block">{m.phone}</a>}
                            </div>
                          </div>
                        )}
                        {participantIds.length > 0 && (
                          <div className="flex items-start gap-3">
                            <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
                              <Users className="w-4 h-4 text-blue-500" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-[11px] text-gray-400 font-medium mb-1.5">شرکت‌کنندگان ({participantIds.length})</p>
                              <div className="flex flex-wrap gap-1.5">
                                {participantIds.map(id => <span key={id} className="text-xs px-2.5 py-1 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full font-medium">{getNameById(id)}</span>)}
                              </div>
                            </div>
                          </div>
                        )}
                        {notifyIds.length > 0 && (
                          <div className="flex items-start gap-3">
                            <div className="w-8 h-8 rounded-lg bg-amber-50 dark:bg-amber-900/30 flex items-center justify-center flex-shrink-0">
                              <svg className="w-4 h-4 text-amber-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-[11px] text-gray-400 font-medium mb-1.5">مطلعین ({notifyIds.length})</p>
                              <div className="flex flex-wrap gap-1.5">
                                {notifyIds.slice(0, 8).map(id => <span key={id} className="text-xs px-2.5 py-1 bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 rounded-full font-medium">{getNameById(id)}</span>)}
                              </div>
                            </div>
                          </div>
                        )}
                        {externalList.length > 0 && (
                          <div className="flex items-start gap-3">
                            <div className="w-8 h-8 rounded-lg bg-green-50 dark:bg-green-900/30 flex items-center justify-center flex-shrink-0">
                              <svg className="w-4 h-4 text-green-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-[11px] text-gray-400 font-medium mb-1.5">خارج سازمان ({externalList.length})</p>
                              <div className="flex flex-wrap gap-1.5">
                                {externalList.map((n: string) => <span key={n} className="text-xs px-2.5 py-1 bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded-full font-medium">{n}</span>)}
                              </div>
                            </div>
                          </div>
                        )}
                        {m.notes && (
                          <div className="p-3 bg-gray-50 dark:bg-gray-700/40 rounded-xl text-sm text-gray-600 dark:text-gray-300 leading-relaxed">{m.notes}</div>
                        )}
                        {canEditM && (
                          <button onClick={() => handleEditMeeting(m)}
                            className="w-full py-2.5 text-sm font-semibold rounded-xl transition-colors text-white"
                            style={{ backgroundColor: c }}>
                            ویرایش جلسه
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
