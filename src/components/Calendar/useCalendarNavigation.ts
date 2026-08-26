// @ts-nocheck
import { useEffect, useMemo } from 'react';
import { MeetingData } from './types';
import {
  JALAALI_MONTHS,
  toJalaali,
  jalaaliToDate,
  getJalaaliMonthDays,
  getJalaaliFirstDayOfWeek,
  isMultiDayView,
  viewDayCount,
} from './utils';

export function useCalendarNavigation(scope: Record<string, any>) {
  const {
    currentJm, currentJy, getMeetings, selectedJd, selectedJm, selectedJy,
    setCurrentJm, setCurrentJy, setSelectedJd, setSelectedJm, setSelectedJy, setSidebarJm,
    setSidebarJy, sidebarJm, sidebarJy, viewMode
  } = scope;

  const moveSelectedByDays = (delta: number) => {
    const d = new Date(jalaaliToDate(selectedJy, selectedJm, selectedJd));
    d.setDate(d.getDate() + delta);
    const j = toJalaali(d);
    setSelectedJy(j.jy); setSelectedJm(j.jm); setSelectedJd(j.jd);
    setCurrentJy(j.jy); setCurrentJm(j.jm);
    setSidebarJy(j.jy); setSidebarJm(j.jm);
  };

  // ---- Navigation ----
  const navigatePrev = () => {
    if (viewMode === 'day') moveSelectedByDays(-1);
    else if (isMultiDayView(viewMode)) moveSelectedByDays(-viewDayCount(viewMode));
    else if (viewMode === 'year') {
      const ny = currentJy - 1;
      setCurrentJy(ny); setSidebarJy(ny);
    }
    else if (viewMode === 'schedule') moveSelectedByDays(-30);
    else {
      let nm = currentJm - 1, ny = currentJy;
      if (nm < 1) { nm = 12; ny--; }
      setCurrentJy(ny); setCurrentJm(nm); setSidebarJy(ny); setSidebarJm(nm);
    }
  };

  const navigateNext = () => {
    if (viewMode === 'day') moveSelectedByDays(1);
    else if (isMultiDayView(viewMode)) moveSelectedByDays(viewDayCount(viewMode));
    else if (viewMode === 'year') {
      const ny = currentJy + 1;
      setCurrentJy(ny); setSidebarJy(ny);
    }
    else if (viewMode === 'schedule') moveSelectedByDays(30);
    else {
      let nm = currentJm + 1, ny = currentJy;
      if (nm > 12) { nm = 1; ny++; }
      setCurrentJy(ny); setCurrentJm(nm); setSidebarJy(ny); setSidebarJm(nm);
    }
  };

  useEffect(() => {
    const handleMobileNavigate = (event: Event) => {
      const direction = (event as CustomEvent<{ direction?: 'next' | 'prev' }>).detail?.direction;
      if (direction === 'next') navigateNext();
      else if (direction === 'prev') navigatePrev();
    };

    window.addEventListener('spark-calendar-mobile-navigate', handleMobileNavigate as EventListener);
    return () => window.removeEventListener('spark-calendar-mobile-navigate', handleMobileNavigate as EventListener);
  }, [viewMode, selectedJy, selectedJm, selectedJd, currentJy, currentJm]);

  const goToToday = () => {
    const { jy, jm, jd } = toJalaali(new Date());
    setCurrentJy(jy); setCurrentJm(jm); setSelectedJy(jy); setSelectedJm(jm); setSelectedJd(jd); setSidebarJy(jy); setSidebarJm(jm);
  };

  // ---- Computed ----
  const weekDays = useMemo((): { jy: number; jm: number; jd: number; weekday: number }[] => {
    if (!selectedJy) return [];
    const selDate = jalaaliToDate(selectedJy, selectedJm, selectedJd);
    const dayOfWeek = selDate.getDay();
    const saturdayOffset = dayOfWeek === 6 ? 0 : -(dayOfWeek + 1);
    const saturday = new Date(selDate);
    saturday.setDate(saturday.getDate() + saturdayOffset);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(saturday);
      d.setDate(d.getDate() + i);
      const j = toJalaali(d);
      return { ...j, weekday: i };
    });
  }, [selectedJy, selectedJm, selectedJd]);

  const displayDays = useMemo(() => {
    if (!selectedJy || !isMultiDayView(viewMode)) return [];
    if (viewMode === 'week') return weekDays;
    if (viewMode === 'work-week') return weekDays.slice(0, 5);

    const count = viewDayCount(viewMode);
    const start = jalaaliToDate(selectedJy, selectedJm, selectedJd);
    return Array.from({ length: count }, (_, i) => {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      const j = toJalaali(d);
      const jsDay = d.getDay();
      return { ...j, weekday: jsDay === 6 ? 0 : jsDay + 1 };
    });
  }, [viewMode, selectedJy, selectedJm, selectedJd, weekDays]);

  const getNavTitle = () => {
    if (viewMode === 'day') return `${selectedJd} ${JALAALI_MONTHS[selectedJm - 1]} ${selectedJy}`;
    if (isMultiDayView(viewMode)) {
      const start = displayDays[0];
      const end = displayDays[displayDays.length - 1];
      if (!start || !end) return '';
      if (start.jy === end.jy && start.jm === end.jm) {
        return `${start.jd} - ${end.jd} ${JALAALI_MONTHS[start.jm - 1]} ${start.jy}`;
      }
      if (start.jy === end.jy) {
        return `${start.jd} ${JALAALI_MONTHS[start.jm - 1]} - ${end.jd} ${JALAALI_MONTHS[end.jm - 1]} ${end.jy}`;
      }
      return `${start.jd} ${JALAALI_MONTHS[start.jm - 1]} ${start.jy} - ${end.jd} ${JALAALI_MONTHS[end.jm - 1]} ${end.jy}`;
    }
    if (viewMode === 'year') return `${currentJy}`;
    if (viewMode === 'schedule') return `برنامه از ${selectedJd} ${JALAALI_MONTHS[selectedJm - 1]} ${selectedJy}`;
    return `${JALAALI_MONTHS[currentJm - 1]} ${currentJy}`;
  };

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
    if (viewMode !== 'schedule') return [];
    const result: { date: string; jy: number; jm: number; jd: number; meetings: MeetingData[] }[] = [];
    if (!selectedJy) return result;
    const start = jalaaliToDate(selectedJy, selectedJm, selectedJd);
    for (let i = 0; i < 30; i++) {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      const j = toJalaali(d);
      const ms = getMeetings(j.jy, j.jm, j.jd);
      if (ms.length > 0) result.push({ date: `${j.jy}/${j.jm}/${j.jd}`, jy: j.jy, jm: j.jm, jd: j.jd, meetings: ms });
    }
    return result;
  }, [viewMode, selectedJy, selectedJm, selectedJd, currentJy, currentJm, weekDays, getMeetings]);

  return {
    getNavTitle, goToToday, listMeetings, mainMonthDays, navigateNext, navigatePrev,
    sidebarMonthDays, weekDays
  };
}