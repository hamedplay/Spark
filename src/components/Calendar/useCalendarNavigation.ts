// @ts-nocheck
import { useMemo } from 'react';
import { MeetingData } from './types';
import { JALAALI_MONTHS, toJalaali, jalaaliToDate, getJalaaliMonthDays, getJalaaliFirstDayOfWeek } from './utils';

export function useCalendarNavigation(scope: Record<string, any>) {
  const {
    currentJm, currentJy, getMeetings, selectedJd, selectedJm, selectedJy,
    setCurrentJm, setCurrentJy, setSelectedJd, setSelectedJm, setSelectedJy, setSidebarJm,
    setSidebarJy, sidebarJm, sidebarJy, viewMode
  } = scope;

  // ---- Navigation ----
  const navigatePrev = () => {
    if (viewMode === 'day') { const d = new Date(jalaaliToDate(selectedJy, selectedJm, selectedJd)); d.setDate(d.getDate() - 1); const j = toJalaali(d); setSelectedJy(j.jy); setSelectedJm(j.jm); setSelectedJd(j.jd); setCurrentJy(j.jy); setCurrentJm(j.jm); }
    else if (viewMode === 'week' || viewMode === 'list-week') { const d = new Date(jalaaliToDate(selectedJy, selectedJm, selectedJd)); d.setDate(d.getDate() - 7); const j = toJalaali(d); setSelectedJy(j.jy); setSelectedJm(j.jm); setSelectedJd(j.jd); setCurrentJy(j.jy); setCurrentJm(j.jm); }
    else { let nm = currentJm - 1, ny = currentJy; if (nm < 1) { nm = 12; ny--; } setCurrentJy(ny); setCurrentJm(nm); setSidebarJy(ny); setSidebarJm(nm); }
  };
  const navigateNext = () => {
    if (viewMode === 'day') { const d = new Date(jalaaliToDate(selectedJy, selectedJm, selectedJd)); d.setDate(d.getDate() + 1); const j = toJalaali(d); setSelectedJy(j.jy); setSelectedJm(j.jm); setSelectedJd(j.jd); setCurrentJy(j.jy); setCurrentJm(j.jm); }
    else if (viewMode === 'week' || viewMode === 'list-week') { const d = new Date(jalaaliToDate(selectedJy, selectedJm, selectedJd)); d.setDate(d.getDate() + 7); const j = toJalaali(d); setSelectedJy(j.jy); setSelectedJm(j.jm); setSelectedJd(j.jd); setCurrentJy(j.jy); setCurrentJm(j.jm); }
    else { let nm = currentJm + 1, ny = currentJy; if (nm > 12) { nm = 1; ny++; } setCurrentJy(ny); setCurrentJm(nm); setSidebarJy(ny); setSidebarJm(nm); }
  };
  const goToToday = () => {
    const { jy, jm, jd } = toJalaali(new Date());
    setCurrentJy(jy); setCurrentJm(jm); setSelectedJy(jy); setSelectedJm(jm); setSelectedJd(jd); setSidebarJy(jy); setSidebarJm(jm);
  };

  const getNavTitle = () => {
    if (viewMode === 'day') return `${selectedJd} ${JALAALI_MONTHS[selectedJm - 1]} ${selectedJy}`;
    if (viewMode === 'week' || viewMode === 'list-week') {
      const start = weekDays[0]; const end = weekDays[6];
      if (!start || !end) return '';
      if (start.jm === end.jm) return `${start.jd} - ${end.jd} ${JALAALI_MONTHS[start.jm - 1]} ${start.jy}`;
      return `${start.jd} ${JALAALI_MONTHS[start.jm - 1]} - ${end.jd} ${JALAALI_MONTHS[end.jm - 1]} ${end.jy}`;
    }
    return `${JALAALI_MONTHS[currentJm - 1]} ${currentJy}`;
  };

  // ---- Computed ----
  const weekDays = useMemo((): { jy: number; jm: number; jd: number; weekday: number }[] => {
    if (!selectedJy) return [];
    const selDate = jalaaliToDate(selectedJy, selectedJm, selectedJd);
    const dayOfWeek = selDate.getDay();
    const saturdayOffset = dayOfWeek === 6 ? 0 : -(dayOfWeek + 1);
    const saturday = new Date(selDate);
    saturday.setDate(saturday.getDate() + saturdayOffset);
    return Array.from({ length: 7 }, (_, i) => { const d = new Date(saturday); d.setDate(d.getDate() + i); const j = toJalaali(d); return { ...j, weekday: i }; });
  }, [selectedJy, selectedJm, selectedJd]);

  const sidebarMonthDays = useMemo(() => {
    if (!sidebarJy) return [];
    const daysInMonth = getJalaaliMonthDays(sidebarJy, sidebarJm);
    const firstDay = getJalaaliFirstDayOfWeek(sidebarJy, sidebarJm);
    const cells: (number | null)[] = [];
    for (let i = 0; i < firstDay; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);
    return cells;
  }, [sidebarJy, sidebarJm]);

  const mainMonthDays = useMemo(() => {
    if (!currentJy) return [];
    const daysInMonth = getJalaaliMonthDays(currentJy, currentJm);
    const firstDay = getJalaaliFirstDayOfWeek(currentJy, currentJm);
    const cells: (number | null)[] = [];
    for (let i = 0; i < firstDay; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);
    return cells;
  }, [currentJy, currentJm]);

  const listMeetings = useMemo(() => {
    if (!viewMode.startsWith('list')) return [];
    const result: { date: string; jy: number; jm: number; jd: number; meetings: MeetingData[] }[] = [];
    if (viewMode === 'list-week') {
      for (const day of weekDays) {
        const ms = getMeetings(day.jy, day.jm, day.jd);
        if (ms.length > 0) result.push({ date: `${day.jy}/${day.jm}/${day.jd}`, jy: day.jy, jm: day.jm, jd: day.jd, meetings: ms });
      }
    } else {
      const daysInMonth = getJalaaliMonthDays(currentJy, currentJm);
      for (let d = 1; d <= daysInMonth; d++) {
        const ms = getMeetings(currentJy, currentJm, d);
        if (ms.length > 0) result.push({ date: `${currentJy}/${currentJm}/${d}`, jy: currentJy, jm: currentJm, jd: d, meetings: ms });
      }
    }
    return result;
  }, [viewMode, currentJy, currentJm, weekDays, getMeetings]);

  return {
    getNavTitle, goToToday, listMeetings, mainMonthDays, navigateNext, navigatePrev,
    sidebarMonthDays, weekDays
  };
}
