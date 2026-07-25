import { useState, useMemo, useCallback } from 'react';
import {
  JALAALI_MONTHS,
  toJalaali, jalaaliToDate, getJalaaliMonthDays, getJalaaliFirstDayOfWeek,
} from './utils';
import { toHijri } from './utils';
import type { MeetingData } from './types';

type ViewMode = 'month' | 'week' | 'day' | 'list-week' | 'list-month';

export interface CalendarNavigationState {
  weekDays: { jy: number; jm: number; jd: number; weekday: number }[];
  sidebarMonthDays: (number | null)[];
  mainMonthDays: (number | null)[];
  listMeetings: { date: string; jy: number; jm: number; jd: number; meetings: MeetingData[] }[];
  getNavTitle: () => string;
  toFarsiTime: (t: string) => string;
  getOccasionsForDay: (jy: number, jm: number, jd: number) => any[];
  isToday: (jy: number, jm: number, jd: number) => boolean;
  isSelected: (jy: number, jm: number, jd: number) => boolean;
  navigatePrev: () => void;
  navigateNext: () => void;
  goToToday: () => void;
}

export function useCalendarNavigation(
  viewMode: ViewMode,
  currentJy: number, currentJm: number,
  setCurrentJy: (v: number) => void, setCurrentJm: (v: number) => void,
  selectedJy: number, selectedJm: number, selectedJd: number,
  setSelectedJy: (v: number) => void, setSelectedJm: (v: number) => void, setSelectedJd: (v: number) => void,
  sidebarJy: number, sidebarJm: number,
  setSidebarJy: (v: number) => void, setSidebarJm: (v: number) => void,
  setViewMode: (v: ViewMode) => void,
  getMeetings: (jy: number, jm: number, jd: number) => MeetingData[],
  occasions: any[], occasionsEnabled: boolean,
): CalendarNavigationState {
  const todayJ = useMemo(() => toJalaali(new Date()), []);
  const isToday = useCallback((jy: number, jm: number, jd: number) => jy === todayJ.jy && jm === todayJ.jm && jd === todayJ.jd, [todayJ]);
  const isSelected = useCallback((jy: number, jm: number, jd: number) => jy === selectedJy && jm === selectedJm && jd === selectedJd, [selectedJy, selectedJm, selectedJd]);

  const navigatePrev = useCallback(() => {
    if (viewMode === 'day') { const d = new Date(jalaaliToDate(selectedJy, selectedJm, selectedJd)); d.setDate(d.getDate() - 1); const j = toJalaali(d); setSelectedJy(j.jy); setSelectedJm(j.jm); setSelectedJd(j.jd); setCurrentJy(j.jy); setCurrentJm(j.jm); }
    else if (viewMode === 'week' || viewMode === 'list-week') { const d = new Date(jalaaliToDate(selectedJy, selectedJm, selectedJd)); d.setDate(d.getDate() - 7); const j = toJalaali(d); setSelectedJy(j.jy); setSelectedJm(j.jm); setSelectedJd(j.jd); setCurrentJy(j.jy); setCurrentJm(j.jm); }
    else { let nm = currentJm - 1, ny = currentJy; if (nm < 1) { nm = 12; ny--; } setCurrentJy(ny); setCurrentJm(nm); setSidebarJy(ny); setSidebarJm(nm); }
  }, [viewMode, selectedJy, selectedJm, selectedJd, currentJy, currentJm, setCurrentJy, setCurrentJm, setSelectedJy, setSelectedJm, setSelectedJd, setSidebarJy, setSidebarJm]);

  const navigateNext = useCallback(() => {
    if (viewMode === 'day') { const d = new Date(jalaaliToDate(selectedJy, selectedJm, selectedJd)); d.setDate(d.getDate() + 1); const j = toJalaali(d); setSelectedJy(j.jy); setSelectedJm(j.jm); setSelectedJd(j.jd); setCurrentJy(j.jy); setCurrentJm(j.jm); }
    else if (viewMode === 'week' || viewMode === 'list-week') { const d = new Date(jalaaliToDate(selectedJy, selectedJm, selectedJd)); d.setDate(d.getDate() + 7); const j = toJalaali(d); setSelectedJy(j.jy); setSelectedJm(j.jm); setSelectedJd(j.jd); setCurrentJy(j.jy); setCurrentJm(j.jm); }
    else { let nm = currentJm + 1, ny = currentJy; if (nm > 12) { nm = 1; ny++; } setCurrentJy(ny); setCurrentJm(nm); setSidebarJy(ny); setSidebarJm(nm); }
  }, [viewMode, selectedJy, selectedJm, selectedJd, currentJy, currentJm, setCurrentJy, setCurrentJm, setSelectedJy, setSelectedJm, setSelectedJd, setSidebarJy, setSidebarJm]);

  const goToToday = useCallback(() => {
    const { jy, jm, jd } = toJalaali(new Date());
    setCurrentJy(jy); setCurrentJm(jm); setSelectedJy(jy); setSelectedJm(jm); setSelectedJd(jd); setSidebarJy(jy); setSidebarJm(jm);
  }, [setCurrentJy, setCurrentJm, setSelectedJy, setSelectedJm, setSelectedJd, setSidebarJy, setSidebarJm]);

  const weekDays = useMemo((): { jy: number; jm: number; jd: number; weekday: number }[] => {
    if (!selectedJy) return [];
    const selDate = jalaaliToDate(selectedJy, selectedJm, selectedJd);
    const dayOfWeek = selDate.getDay();
    const saturdayOffset = dayOfWeek === 6 ? 0 : -(dayOfWeek + 1);
    const saturday = new Date(selDate);
    saturday.setDate(saturday.getDate() + saturdayOffset);
    return Array.from({ length: 7 }, (_, i) => { const d = new Date(saturday); d.setDate(d.getDate() + i); const j = toJalaali(d); return { ...j, weekday: i }; });
  }, [selectedJy, selectedJm, selectedJd]);

  const getNavTitle = useCallback(() => {
    if (viewMode === 'day') return `${selectedJd} ${JALAALI_MONTHS[selectedJm - 1]} ${selectedJy}`;
    if (viewMode === 'week' || viewMode === 'list-week') {
      const start = weekDays[0]; const end = weekDays[6];
      if (!start || !end) return '';
      if (start.jm === end.jm) return `${start.jd} - ${end.jd} ${JALAALI_MONTHS[start.jm - 1]} ${start.jy}`;
      return `${start.jd} ${JALAALI_MONTHS[start.jm - 1]} - ${end.jd} ${JALAALI_MONTHS[end.jm - 1]} ${end.jy}`;
    }
    return `${JALAALI_MONTHS[currentJm - 1]} ${currentJy}`;
  }, [viewMode, selectedJd, selectedJm, selectedJy, weekDays, currentJm, currentJy]);

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

  const toFarsiTime = useCallback((t: string) => {
    if (!t) return '';
    const farsiDigits = ['۰','۱','۲','۳','۴','۵','۶','۷','۸','۹'];
    return t.replace(/\d/g, d => farsiDigits[parseInt(d)]);
  }, []);

  const getOccasionsForDay = useCallback((jy: number, jm: number, jd: number) => {
    if (!occasionsEnabled) return [];
    const greg = jalaaliToDate(jy, jm, jd);
    const hijri = toHijri(greg);
    return occasions.filter(o =>
      o.calendar_type === 'shamsi'
        ? o.month === jm && o.day === jd
        : o.month === hijri.hm && o.day === hijri.hd
    );
  }, [occasions, occasionsEnabled]);

  return {
    weekDays, sidebarMonthDays, mainMonthDays, listMeetings,
    getNavTitle, toFarsiTime, getOccasionsForDay,
    isToday, isSelected, navigatePrev, navigateNext, goToToday,
  };
}
