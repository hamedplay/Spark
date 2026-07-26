import { useMemo } from 'react';
import type { MeetingData } from './types';
import type { CalendarDragResizeState } from './useCalendarDragResize';
import type { CalendarDialogsState } from './useCalendarDialogs';

export interface CalendarViewPropsInput {
  viewMode: string;
  selectedJy: number;
  selectedJm: number;
  selectedJd: number;
  currentJy: number;
  currentJm: number;
  currentTime: Date;
  currentUserId: string | null;
  getMeetings: (jy: number, jm: number, jd: number) => MeetingData[];
  getMeetingColor: (m: MeetingData) => string;
  resolveName: (uid: string) => string;
  weekDays: { jy: number; jm: number; jd: number; weekday: number }[];
  mainMonthDays: (number | null)[];
  listMeetings: { date: string; jy: number; jm: number; jd: number; meetings: MeetingData[] }[];
  getOccasionsForDay: (jy: number, jm: number, jd: number) => any[];
  getAllDayEventsForDay: (jy: number, jm: number, jd: number) => any[];
  fetchAllDayEvents: () => Promise<void>;
  isInAllDayDragRange: (jy: number, jm: number, jd: number) => boolean;
  slotHeight: number;
  totalSlots: number;
  hideOffHours: boolean;
  visibleStartHour: number;
  visibleEndHour: number;
  workStartMin: number;
  workEndMin: number;
  isToday: (jy: number, jm: number, jd: number) => boolean;
  isSelected: (jy: number, jm: number, jd: number) => boolean;
  toFarsiTime: (t: string) => string;
  timeGridRef: React.RefObject<HTMLDivElement | null>;
  timeScrollRef: React.RefObject<HTMLDivElement | null>;
  listScrollRef: React.RefObject<HTMLDivElement | null>;
  handleHourColTouchStart: (e: React.TouchEvent) => void;
  handleHourColTouchMove: (e: React.TouchEvent) => void;
  handleHourColTouchEnd: () => void;
  adjustSlotHeight: (delta: number) => void;
  setViewMode: React.Dispatch<React.SetStateAction<string>>;
  drag: CalendarDragResizeState;
  dialogs: CalendarDialogsState;
}

export function useCalendarViewProps(input: CalendarViewPropsInput) {
  return useMemo(() => {
    const {
      viewMode, selectedJy, selectedJm, selectedJd,
      currentJy, currentJm, currentTime, currentUserId,
      getMeetings, getMeetingColor, resolveName,
      weekDays, mainMonthDays, listMeetings,
      getOccasionsForDay, getAllDayEventsForDay, fetchAllDayEvents,
      isInAllDayDragRange,
      slotHeight, totalSlots,
      hideOffHours, visibleStartHour, visibleEndHour, workStartMin, workEndMin,
      isToday, isSelected, toFarsiTime,
      timeGridRef, timeScrollRef, listScrollRef,
      handleHourColTouchStart, handleHourColTouchMove, handleHourColTouchEnd,
      adjustSlotHeight, setViewMode,
      drag, dialogs,
    } = input;

    return {
      viewMode,
      selectedJy, selectedJm, selectedJd,
      currentJy, currentJm,
      currentTime,
      currentUserId,
      getMeetings,
      getMeetingColor,
      resolveName,
      weekDays,
      mainMonthDays,
      listMeetings,
      getOccasionsForDay,
      getAllDayEventsForDay,
      fetchAllDayEvents,
      isInAllDayDragRange,
      slotHeight,
      totalSlots,
      hideOffHours,
      visibleStartHour,
      visibleEndHour,
      workStartMin,
      workEndMin,
      isToday,
      isSelected,
      toFarsiTime,
      isDragging: drag.isDragging,
      dragStartSlot: drag.dragStartSlot,
      dragEndSlot: drag.dragEndSlot,
      dragDate: drag.dragDate,
      dragMoveMeeting: drag.dragMoveMeeting,
      dragMoveOriginalSlot: drag.dragMoveOriginalSlot,
      dragMoveOriginalEndSlot: drag.dragMoveOriginalEndSlot,
      dragMoveCurrentDeltaSlot: drag.dragMoveCurrentDeltaSlot,
      dragMoveCurrentDeltaDay: drag.dragMoveCurrentDeltaDay,
      dragMovedRef: drag.dragMovedRef,
      setDragMoveMeeting: drag.setDragMoveMeeting,
      setDragMoveStartY: drag.setDragMoveStartY,
      setDragMoveStartX: drag.setDragMoveStartX,
      setDragMoveOriginalSlot: drag.setDragMoveOriginalSlot,
      setDragMoveOriginalEndSlot: drag.setDragMoveOriginalEndSlot,
      setDragMoveCurrentDeltaSlot: drag.setDragMoveCurrentDeltaSlot,
      setDragMoveCurrentDeltaDay: drag.setDragMoveCurrentDeltaDay,
      setDragMoveOriginalDate: drag.setDragMoveOriginalDate,
      resizeMeeting: drag.resizeMeeting,
      resizeOriginalEndSlot: drag.resizeOriginalEndSlot,
      resizeCurrentDelta: drag.resizeCurrentDelta,
      setResizeMeeting: drag.setResizeMeeting,
      setResizeStartY: drag.setResizeStartY,
      setResizeOriginalEndSlot: drag.setResizeOriginalEndSlot,
      setResizeCurrentDelta: drag.setResizeCurrentDelta,
      allDayDragging: false,
      allDayDragStart: null,
      allDayDragEnd: null,
      setAllDayDragStart: () => {},
      setAllDayDragEnd: () => {},
      setAllDayDragging: () => {},
      setAllDayFormDate: dialogs.setAllDayFormDate,
      setAllDayFormEndDate: dialogs.setAllDayFormEndDate,
      setShowAllDayForm: dialogs.setShowAllDayForm,
      timeGridRef,
      timeScrollRef,
      weekGridRef: drag.weekGridRef,
      dayGridRef: drag.dayGridRef,
      previewRef: dialogs.previewRef,
      handleGridMouseDown: drag.handleGridMouseDown,
      handleGridMouseMove: drag.handleGridMouseMove,
      handleGridTouchStart: drag.handleGridTouchStart,
      handleGridTouchMove: drag.handleGridTouchMove,
      commitDrag: drag.commitDrag,
      handleHourColTouchStart,
      handleHourColTouchMove,
      handleHourColTouchEnd,
      adjustSlotHeight,
      handleEditMeeting: dialogs.handleEditMeeting,
      handleBlockClick: dialogs.handleBlockClick,
      setSelectedJy: (v: number) => {},
      setSelectedJm: (v: number) => {},
      setSelectedJd: (v: number) => {},
      setViewMode: setViewMode as (v: string) => void,
      setMonthDayPopup: dialogs.setMonthDayPopup,
      onCreateMeetingForDay: dialogs.handleCreateMeetingForDay,
      previewMeeting: dialogs.previewMeeting,
      previewPos: dialogs.previewPos,
      setPreviewMeeting: dialogs.setPreviewMeeting,
      setDetailMeeting: dialogs.setDetailMeeting,
      expandedMeetingId: dialogs.expandedMeetingId,
      setExpandedMeetingId: dialogs.setExpandedMeetingId,
      listScrollRef,
    };
  }, [input]);
}
