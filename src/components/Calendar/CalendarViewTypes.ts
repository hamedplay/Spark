import React from 'react';
import { MeetingData } from './types';

export interface CalendarViewProps {
  viewMode: 'day' | '3-day' | '4-day' | 'work-week' | 'week' | 'month' | 'year' | 'schedule';

  // Date state
  selectedJy: number; selectedJm: number; selectedJd: number;
  currentJy: number; currentJm: number;
  currentTime: Date;
  currentUserId: string | null;

  // Meeting data
  getMeetings: (jy: number, jm: number, jd: number) => MeetingData[];
  getMeetingColor: (m: MeetingData) => string;
  resolveName: (uid: string) => string;
  weekDays: Array<{ jy: number; jm: number; jd: number; weekday: number }>;
  mainMonthDays: Array<number | null>;
  listMeetings: Array<{ date: string; jy: number; jm: number; jd: number; meetings: MeetingData[] }>;

  // Calendar events
  getOccasionsForDay: (jy: number, jm: number, jd: number) => any[];
  getAllDayEventsForDay: (jy: number, jm: number, jd: number) => any[];
  fetchAllDayEvents: () => void;
  isInAllDayDragRange: (jy: number, jm: number, jd: number) => boolean;

  // Time grid
  slotHeight: number;
  totalSlots: number;
  hideOffHours: boolean;
  visibleStartHour: number;
  visibleEndHour: number;
  workStartMin: number;
  workEndMin: number;

  // Computed
  isToday: (jy: number, jm: number, jd: number) => boolean;
  isSelected: (jy: number, jm: number, jd: number) => boolean;
  toFarsiTime: (t: string) => string;

  // Drag state - new meeting
  isDragging: boolean;
  dragStartSlot: number | null;
  dragEndSlot: number | null;
  dragDate: { jy: number; jm: number; jd: number } | null;

  // Drag state - move meeting
  dragMoveMeeting: MeetingData | null;
  dragMoveOriginalSlot: number;
  dragMoveOriginalEndSlot: number;
  dragMoveCurrentDeltaSlot: number;
  dragMoveCurrentDeltaDay: number;
  dragMovedRef: React.MutableRefObject<boolean>;
  setDragMoveMeeting: (m: MeetingData | null) => void;
  setDragMoveStartY: (v: number) => void;
  setDragMoveStartX: (v: number) => void;
  setDragMoveOriginalSlot: (v: number) => void;
  setDragMoveOriginalEndSlot: (v: number) => void;
  setDragMoveCurrentDeltaSlot: (v: number) => void;
  setDragMoveCurrentDeltaDay: (v: number) => void;
  setDragMoveOriginalDate: (v: string) => void;

  // Drag state - resize
  resizeMeeting: MeetingData | null;
  resizeOriginalEndSlot: number;
  resizeCurrentDelta: number;
  setResizeMeeting: (m: MeetingData | null) => void;
  setResizeStartY: (v: number) => void;
  setResizeOriginalEndSlot: (v: number) => void;
  setResizeCurrentDelta: (v: number) => void;

  // All-day drag
  allDayDragging: boolean;
  allDayDragStart: { jy: number; jm: number; jd: number } | null;
  allDayDragEnd: { jy: number; jm: number; jd: number } | null;
  setAllDayDragStart: (v: { jy: number; jm: number; jd: number } | null) => void;
  setAllDayDragEnd: (v: { jy: number; jm: number; jd: number } | null) => void;
  setAllDayDragging: (v: boolean) => void;
  setAllDayFormDate: (v: { jy: number; jm: number; jd: number } | null) => void;
  setAllDayFormEndDate: (v: { jy: number; jm: number; jd: number } | null) => void;
  setShowAllDayForm: (v: boolean) => void;

  // Refs
  timeGridRef: React.MutableRefObject<HTMLDivElement | null>;
  timeScrollRef: React.MutableRefObject<HTMLDivElement | null>;
  weekGridRef: React.MutableRefObject<HTMLDivElement | null>;
  dayGridRef: React.MutableRefObject<HTMLDivElement | null>;
  previewRef: React.MutableRefObject<HTMLDivElement | null>;

  // Grid event handlers
  handleGridMouseDown: (e: React.MouseEvent, jy: number, jm: number, jd: number) => void;
  handleGridMouseMove: (e: React.MouseEvent) => void;
  handleGridTouchStart: (e: React.TouchEvent, jy: number, jm: number, jd: number) => void;
  handleGridTouchMove: (e: React.TouchEvent) => void;
  commitDrag: () => void;
  handleHourColTouchStart: (e: React.TouchEvent) => void;
  handleHourColTouchMove: (e: React.TouchEvent) => void;
  handleHourColTouchEnd: () => void;
  adjustSlotHeight: (delta: number) => void;

  // Meeting handlers
  handleEditMeeting: (m: MeetingData) => void;
  handleBlockClick: (m: MeetingData, e: React.MouseEvent) => void;

  // Navigation setters
  setSelectedJy: (v: number) => void;
  setSelectedJm: (v: number) => void;
  setSelectedJd: (v: number) => void;
  setViewMode: (v: string) => void;

  // Popup setters
  setMonthDayPopup: (v: any) => void;
  onCreateMeetingForDay?: (jy: number, jm: number, jd: number) => void;

  // Preview popup
  previewMeeting: MeetingData | null;
  previewPos: { x: number; y: number };
  setPreviewMeeting: (m: MeetingData | null) => void;
  setDetailMeeting: (m: MeetingData | null) => void;

  // List view
  expandedMeetingId: string | null;
  setExpandedMeetingId: (v: string | null) => void;
  listScrollRef?: React.MutableRefObject<HTMLDivElement | null>;
}

export interface OverlapInfo {
  meeting: MeetingData;
  leftPct: number;
  widthPct: number;
  zIndex: number;
  isNested: boolean;
}
