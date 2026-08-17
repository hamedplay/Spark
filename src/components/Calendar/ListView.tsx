import React from 'react';
import { Clock, MapPin, ChevronRight, Calendar, Users } from 'lucide-react';
import { JALAALI_MONTHS, JALAALI_WEEKDAYS, jalaaliToDate, jsDayToWeekday } from './utils';
import { CalendarViewProps } from './CalendarViewTypes';

export function ListView(p: CalendarViewProps) {
  const {
    listMeetings, listScrollRef, isToday,
    getMeetingColor, resolveName, toFarsiTime,
    currentUserId, expandedMeetingId, setExpandedMeetingId, handleEditMeeting,
  } = p;

  return (
    <div ref={listScrollRef} className="mx-2 mb-2 mt-1 flex-1 overflow-y-auto rounded-2xl border border-slate-200/80 bg-slate-50/55 p-2.5 shadow-[0_10px_30px_rgba(15,23,42,0.04)] dark:border-slate-800 dark:bg-slate-950 dark:shadow-none sm:mx-3 sm:mb-3 sm:p-3">
      {listMeetings.length === 0 ? (
        <div className="py-16 text-center text-slate-400">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-50 text-violet-400 dark:bg-violet-500/10 dark:text-violet-300">
            <Calendar className="h-6 w-6" />
          </div>
          <p className="text-xs">جلسه‌ای در این بازه وجود ندارد</p>
        </div>
      ) : listMeetings.map(group => (
        <div key={group.date} {...(isToday(group.jy, group.jm, group.jd) ? { 'data-today': 'true' } : {})} className="mb-3 last:mb-0">
          <div className="sticky top-0 z-10 mb-1.5 flex items-center gap-2.5 rounded-xl bg-slate-50/95 px-1 py-1 backdrop-blur dark:bg-slate-950/95">
            <div className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl text-sm font-bold ${isToday(group.jy, group.jm, group.jd)
              ? 'bg-violet-600 text-white shadow-sm dark:bg-violet-500'
              : 'border border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-white'}`}>{group.jd}</div>
            <div>
              <p className="text-xs font-bold text-slate-700 dark:text-white">{JALAALI_WEEKDAYS[jsDayToWeekday(jalaaliToDate(group.jy, group.jm, group.jd).getDay())]}</p>
              <p className="text-[10px] text-slate-400">{JALAALI_MONTHS[group.jm - 1]} {group.jy}</p>
            </div>
            <span className="mr-auto rounded-full bg-white px-2 py-0.5 text-[9px] text-slate-500 ring-1 ring-slate-200 dark:bg-slate-900 dark:text-slate-400 dark:ring-slate-700">{group.meetings.length} جلسه</span>
          </div>

          <div className="space-y-1.5">
            {group.meetings.map(m => {
              const c = getMeetingColor(m);
              const isExp = expandedMeetingId === m.id;
              const canEditM = m.user_id === currentUserId || m.meeting_manager === currentUserId;
              const participantIds = m.participant_user_ids || [];
              const notifyIds = (m.notify_users || []) as string[];
              const externalList = m.external_participants || [];
              const getNameById = (id: string) => resolveName(id);

              return (
                <div key={m.id} className={`overflow-hidden rounded-xl border bg-white transition-all dark:bg-slate-900 ${isExp
                  ? 'border-violet-200 shadow-[0_10px_25px_rgba(124,58,237,0.08)] dark:border-violet-500/25'
                  : 'border-slate-200/80 shadow-[0_4px_14px_rgba(15,23,42,0.03)] hover:border-slate-300 hover:shadow-[0_8px_20px_rgba(15,23,42,0.06)] dark:border-slate-800 dark:hover:border-slate-700'}`}
                >
                  <button className="flex w-full items-center gap-2.5 px-3 py-2.5 text-right" onClick={() => setExpandedMeetingId(isExp ? null : m.id)}>
                    <div className="w-1 self-stretch flex-shrink-0 rounded-full" style={{ backgroundColor: c }} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-bold text-slate-800 dark:text-white">{m.subject}</p>
                      <div className="mt-1 flex flex-wrap gap-2.5 text-[10px] text-slate-500 dark:text-slate-400">
                        {m.start_time && m.end_time && (
                          <span className="flex items-center gap-1 text-cyan-700 dark:text-cyan-300">
                            <Clock className="h-3 w-3" />{toFarsiTime(m.start_time)} – {toFarsiTime(m.end_time)}
                          </span>
                        )}
                        {m.location && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{m.location}</span>}
                      </div>
                    </div>
                    <ChevronRight className={`h-4 w-4 flex-shrink-0 text-slate-300 transition-transform duration-200 dark:text-slate-600 ${isExp ? '-rotate-90' : ''}`} />
                  </button>

                  {isExp && (
                    <div className="border-t border-slate-100 dark:border-slate-800">
                      <div className="space-y-3 px-3.5 py-3">
                        {m.representative && (
                          <div className="flex items-start gap-2.5">
                            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800">
                              <svg className="h-4 w-4 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 1 0-16 0"/></svg>
                            </div>
                            <div>
                              <p className="mb-0.5 text-[10px] text-slate-400">نماینده</p>
                              <p className="text-xs font-bold text-slate-700 dark:text-white">{m.representative}</p>
                              {m.phone && <a href={`tel:${m.phone}`} className="mt-0.5 block text-[10px] text-cyan-600 dark:text-cyan-300">{m.phone}</a>}
                            </div>
                          </div>
                        )}

                        {participantIds.length > 0 && (
                          <div className="flex items-start gap-2.5">
                            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-indigo-50 dark:bg-indigo-500/10">
                              <Users className="h-4 w-4 text-indigo-500 dark:text-indigo-300" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="mb-1.5 text-[10px] text-slate-400">شرکت‌کنندگان ({participantIds.length})</p>
                              <div className="flex flex-wrap gap-1">
                                {participantIds.map(id => <span key={id} className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300">{getNameById(id)}</span>)}
                              </div>
                            </div>
                          </div>
                        )}

                        {notifyIds.length > 0 && (
                          <div className="flex items-start gap-2.5">
                            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-amber-50 dark:bg-amber-500/10">
                              <svg className="h-4 w-4 text-amber-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="mb-1.5 text-[10px] text-slate-400">مطلعین ({notifyIds.length})</p>
                              <div className="flex flex-wrap gap-1">
                                {notifyIds.slice(0, 8).map(id => <span key={id} className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">{getNameById(id)}</span>)}
                              </div>
                            </div>
                          </div>
                        )}

                        {externalList.length > 0 && (
                          <div className="flex items-start gap-2.5">
                            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-emerald-50 dark:bg-emerald-500/10">
                              <svg className="h-4 w-4 text-emerald-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="mb-1.5 text-[10px] text-slate-400">خارج سازمان ({externalList.length})</p>
                              <div className="flex flex-wrap gap-1">
                                {externalList.map((n: string) => <span key={n} className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">{n}</span>)}
                              </div>
                            </div>
                          </div>
                        )}

                        {m.notes && (
                          <div className="rounded-lg border border-slate-100 bg-slate-50 p-2.5 text-xs leading-relaxed text-slate-600 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-300">{m.notes}</div>
                        )}

                        {canEditM && (
                          <button
                            onClick={() => handleEditMeeting(m)}
                            className="w-full rounded-lg py-2 text-xs font-bold text-white shadow-sm transition-opacity hover:opacity-90"
                            style={{ backgroundColor: c }}
                          >
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
