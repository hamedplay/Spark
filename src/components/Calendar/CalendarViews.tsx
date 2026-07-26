import React from 'react';
import { Clock, MapPin, X } from 'lucide-react';
import { MeetingData } from './types';
import { DayView } from './DayView';
import { WeekView } from './WeekView';
import { MonthView } from './MonthView';
import { ListView } from './ListView';
import type { MeetingBlockProps } from './MeetingBlock';

export interface CalendarViewProps {
  viewMode: 'month' | 'week' | 'day' | 'list-week' | 'list-month';

  selectedJy: number; selectedJm: number; selectedJd: number;
  currentJy: number; currentJm: number;
  currentTime: Date;
  currentUserId: string | null;

  getMeetings: (jy: number, jm: number, jd: number) => MeetingData[];
  getMeetingColor: (m: MeetingData) => string;
  resolveName: (uid: string) => string;
  weekDays: Array<{ jy: number; jm: number; jd: number; weekday: number }>;
  mainMonthDays: Array<number | null>;
  listMeetings: Array<{ date: string; jy: number; jm: number; jd: number; meetings: MeetingData[] }>;

  getOccasionsForDay: (jy: number, jm: number, jd: number) => any[];
  getAllDayEventsForDay: (jy: number, jm: number, jd: number) => any[];
  fetchAllDayEvents: () => void;
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

  isDragging: boolean;
  dragStartSlot: number | null;
  dragEndSlot: number | null;
  dragDate: { jy: number; jm: number; jd: number } | null;

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

  resizeMeeting: MeetingData | null;
  resizeOriginalEndSlot: number;
  resizeCurrentDelta: number;
  setResizeMeeting: (m: MeetingData | null) => void;
  setResizeStartY: (v: number) => void;
  setResizeOriginalEndSlot: (v: number) => void;
  setResizeCurrentDelta: (v: number) => void;

  allDayDragging: boolean;
  allDayDragStart: { jy: number; jm: number; jd: number } | null;
  allDayDragEnd: { jy: number; jm: number; jd: number } | null;
  setAllDayDragStart: (v: { jy: number; jm: number; jd: number } | null) => void;
  setAllDayDragEnd: (v: { jy: number; jm: number; jd: number } | null) => void;
  setAllDayDragging: (v: boolean) => void;
  setAllDayFormDate: (v: { jy: number; jm: number; jd: number } | null) => void;
  setAllDayFormEndDate: (v: { jy: number; jm: number; jd: number } | null) => void;
  setShowAllDayForm: (v: boolean) => void;

  timeGridRef: React.MutableRefObject<HTMLDivElement | null>;
  timeScrollRef: React.MutableRefObject<HTMLDivElement | null>;
  weekGridRef: React.MutableRefObject<HTMLDivElement | null>;
  dayGridRef: React.MutableRefObject<HTMLDivElement | null>;
  previewRef: React.MutableRefObject<HTMLDivElement | null>;

  handleGridMouseDown: (e: React.MouseEvent, jy: number, jm: number, jd: number) => void;
  handleGridMouseMove: (e: React.MouseEvent) => void;
  handleGridTouchStart: (e: React.TouchEvent, jy: number, jm: number, jd: number) => void;
  handleGridTouchMove: (e: React.TouchEvent) => void;
  commitDrag: () => void;
  handleHourColTouchStart: (e: React.TouchEvent) => void;
  handleHourColTouchMove: (e: React.TouchEvent) => void;
  handleHourColTouchEnd: () => void;
  adjustSlotHeight: (delta: number) => void;

  handleEditMeeting: (m: MeetingData) => void;
  handleBlockClick: (m: MeetingData, e: React.MouseEvent) => void;

  setSelectedJy: (v: number) => void;
  setSelectedJm: (v: number) => void;
  setSelectedJd: (v: number) => void;
  setViewMode: (v: string) => void;

  setMonthDayPopup: (v: any) => void;
  onCreateMeetingForDay?: (jy: number, jm: number, jd: number) => void;

  previewMeeting: MeetingData | null;
  previewPos: { x: number; y: number };
  setPreviewMeeting: (m: MeetingData | null) => void;
  setDetailMeeting: (m: MeetingData | null) => void;

  expandedMeetingId: string | null;
  setExpandedMeetingId: (v: string | null) => void;
  listScrollRef?: React.MutableRefObject<HTMLDivElement | null>;
}

export function CalendarViews(p: CalendarViewProps) {
  const {
    viewMode, slotHeight, totalSlots, hideOffHours, workStartMin, workEndMin,
    visibleStartHour, visibleEndHour, currentTime, currentUserId,
    getMeetings, getMeetingColor, resolveName,
    isToday, isSelected, toFarsiTime,
    isDragging, dragStartSlot, dragEndSlot, dragDate,
    dragMoveMeeting, dragMoveOriginalSlot, dragMoveOriginalEndSlot,
    dragMoveCurrentDeltaSlot, dragMoveCurrentDeltaDay, dragMovedRef,
    setDragMoveMeeting, setDragMoveStartY, setDragMoveStartX,
    setDragMoveOriginalSlot, setDragMoveOriginalEndSlot,
    setDragMoveCurrentDeltaSlot, setDragMoveCurrentDeltaDay, setDragMoveOriginalDate,
    resizeMeeting, resizeOriginalEndSlot, resizeCurrentDelta,
    setResizeMeeting, setResizeStartY, setResizeOriginalEndSlot, setResizeCurrentDelta,
    allDayDragging, allDayDragStart, allDayDragEnd,
    setAllDayDragStart, setAllDayDragEnd, setAllDayDragging,
    setAllDayFormDate, setAllDayFormEndDate, setShowAllDayForm,
    timeGridRef, timeScrollRef, weekGridRef, dayGridRef, previewRef,
    handleGridMouseDown, handleGridMouseMove, handleGridTouchStart, handleGridTouchMove,
    commitDrag, handleHourColTouchStart, handleHourColTouchMove, handleHourColTouchEnd,
    adjustSlotHeight, handleEditMeeting, handleBlockClick,
    setSelectedJy, setSelectedJm, setSelectedJd, setViewMode,
    setMonthDayPopup, onCreateMeetingForDay, previewMeeting, previewPos, setPreviewMeeting, setDetailMeeting,
    expandedMeetingId, setExpandedMeetingId,
    selectedJy, selectedJm, selectedJd, currentJy, currentJm,
    getOccasionsForDay, getAllDayEventsForDay, fetchAllDayEvents, isInAllDayDragRange,
    weekDays, mainMonthDays, listMeetings, listScrollRef,
  } = p;

  const blockProps: Omit<MeetingBlockProps, 'meeting' | 'colWidthMultiple' | 'leftPct' | 'widthPct' | 'blockZIndex' | 'isNested'> = {
    slotHeight, viewMode, currentUserId, getMeetingColor, toFarsiTime,
    dragMoveMeeting, dragMoveOriginalSlot, dragMoveOriginalEndSlot,
    dragMoveCurrentDeltaSlot, dragMoveCurrentDeltaDay, dragMovedRef,
    resizeMeeting, resizeOriginalEndSlot, resizeCurrentDelta,
    setDragMoveMeeting, setDragMoveStartY, setDragMoveStartX,
    setDragMoveOriginalSlot, setDragMoveOriginalEndSlot,
    setDragMoveCurrentDeltaSlot, setDragMoveCurrentDeltaDay, setDragMoveOriginalDate,
    setResizeMeeting, setResizeStartY, setResizeOriginalEndSlot, setResizeCurrentDelta,
    setPreviewMeeting, handleEditMeeting, handleBlockClick,
  };

  const renderPreviewPopup = () => {
    if (!previewMeeting) return null;
    const m = previewMeeting;
    const color = getMeetingColor(m);
    const participantIds = m.participant_user_ids || [];
    const notifyIds = (m.notify_users || []) as string[];
    const getNameById = (id: string) => resolveName(id);
    const isMobile = window.innerWidth < 640;
    const popupStyle: React.CSSProperties = isMobile
      ? { position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }
      : {
          position: 'absolute',
          top: Math.min(previewPos.y, window.innerHeight - 420),
          right: window.innerWidth - previewPos.x < 300 ? window.innerWidth - previewPos.x + 8 : undefined,
          left: window.innerWidth - previewPos.x >= 300 ? previewPos.x + 8 : undefined,
        };
    return (
      <div className="fixed inset-0 z-[60] pointer-events-none" dir="rtl">
        {isMobile && <div className="absolute inset-0 bg-black/30 pointer-events-auto" onClick={() => setPreviewMeeting(null)} />}
        <div ref={previewRef}
          className="pointer-events-auto bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-100 dark:border-gray-700 w-72 max-h-[90vh] overflow-y-auto"
          style={popupStyle}
          onClick={e => e.stopPropagation()}
        >
          <div className="h-2 rounded-t-2xl w-full" style={{ backgroundColor: color }} />
          <div className="p-4">
            <div className="flex items-start justify-between gap-2 mb-3">
              <h3 className="font-bold text-gray-900 dark:text-white text-sm leading-tight">{m.subject}</h3>
              <button onClick={() => setPreviewMeeting(null)} className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 flex-shrink-0 -mt-0.5">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-2 text-sm">
              {m.start_time && m.end_time && (
                <div className="flex items-center gap-2 text-gray-600 dark:text-gray-300">
                  <Clock className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                  <span className="font-medium">{toFarsiTime(m.start_time)} – {toFarsiTime(m.end_time)}</span>
                </div>
              )}
              {m.location && (
                <div className="flex items-center gap-2 text-gray-600 dark:text-gray-300">
                  <MapPin className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                  <span>{m.location}</span>
                </div>
              )}
              {m.representative && (
                <div className="flex items-center gap-2 text-gray-600 dark:text-gray-300">
                  <svg className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 1 0-16 0"/></svg>
                  <span>{m.representative}</span>
                </div>
              )}
              {participantIds.length > 0 && (
                <div className="pt-1">
                  <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">شرکت‌کنندگان</p>
                  <div className="flex flex-wrap gap-1">
                    {participantIds.map(id => (
                      <span key={id} className="text-[11px] px-2 py-0.5 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full">{getNameById(id)}</span>
                    ))}
                  </div>
                </div>
              )}
              {notifyIds.length > 0 && (
                <div className="pt-1">
                  <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">مطلعین</p>
                  <div className="flex flex-wrap gap-1">
                    {notifyIds.slice(0, 6).map(id => (
                      <span key={id} className="text-[11px] px-2 py-0.5 bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 rounded-full">{getNameById(id)}</span>
                    ))}
                  </div>
                </div>
              )}
              {m.notes && (
                <div className="p-2.5 bg-gray-50 dark:bg-gray-700/50 rounded-xl text-xs text-gray-500 dark:text-gray-400 leading-relaxed mt-1">{m.notes}</div>
              )}
            </div>
            <div className="mt-4 flex gap-2">
              <button onClick={() => { setPreviewMeeting(null); setDetailMeeting(m); }}
                className="flex-1 py-2 text-xs font-semibold bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-xl hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors">
                جزئیات بیشتر
              </button>
              {(m.user_id === currentUserId || m.meeting_manager === currentUserId) && (
                <button onClick={() => { setPreviewMeeting(null); handleEditMeeting(m); }}
                  className="flex-1 py-2 text-xs font-semibold text-white rounded-xl transition-colors hover:opacity-90"
                  style={{ backgroundColor: color }}>
                  ویرایش
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <>
      {renderPreviewPopup()}
      {viewMode === 'day' && (
        <DayView
          selectedJy={selectedJy} selectedJm={selectedJm} selectedJd={selectedJd}
          slotHeight={slotHeight} totalSlots={totalSlots}
          hideOffHours={hideOffHours} visibleStartHour={visibleStartHour} visibleEndHour={visibleEndHour}
          workStartMin={workStartMin} workEndMin={workEndMin}
          currentTime={currentTime} currentUserId={currentUserId}
          getMeetings={getMeetings} getMeetingColor={getMeetingColor}
          isToday={isToday} toFarsiTime={toFarsiTime}
          isDragging={isDragging} dragStartSlot={dragStartSlot} dragEndSlot={dragEndSlot} dragDate={dragDate}
          dragMoveMeeting={dragMoveMeeting} dragMoveOriginalSlot={dragMoveOriginalSlot} dragMoveOriginalEndSlot={dragMoveOriginalEndSlot}
          dragMoveCurrentDeltaSlot={dragMoveCurrentDeltaSlot} dragMoveCurrentDeltaDay={dragMoveCurrentDeltaDay} dragMovedRef={dragMovedRef}
          resizeMeeting={resizeMeeting} resizeOriginalEndSlot={resizeOriginalEndSlot} resizeCurrentDelta={resizeCurrentDelta}
          setDragMoveMeeting={setDragMoveMeeting} setDragMoveStartY={setDragMoveStartY} setDragMoveStartX={setDragMoveStartX}
          setDragMoveOriginalSlot={setDragMoveOriginalSlot} setDragMoveOriginalEndSlot={setDragMoveOriginalEndSlot}
          setDragMoveCurrentDeltaSlot={setDragMoveCurrentDeltaSlot} setDragMoveCurrentDeltaDay={setDragMoveCurrentDeltaDay} setDragMoveOriginalDate={setDragMoveOriginalDate}
          setResizeMeeting={setResizeMeeting} setResizeStartY={setResizeStartY} setResizeOriginalEndSlot={setResizeOriginalEndSlot} setResizeCurrentDelta={setResizeCurrentDelta}
          setPreviewMeeting={setPreviewMeeting}
          handleGridMouseDown={handleGridMouseDown} handleGridMouseMove={handleGridMouseMove}
          handleGridTouchStart={handleGridTouchStart} handleGridTouchMove={handleGridTouchMove}
          commitDrag={commitDrag}
          handleHourColTouchStart={handleHourColTouchStart} handleHourColTouchMove={handleHourColTouchMove} handleHourColTouchEnd={handleHourColTouchEnd}
          adjustSlotHeight={adjustSlotHeight}
          handleEditMeeting={handleEditMeeting} handleBlockClick={handleBlockClick}
          getOccasionsForDay={getOccasionsForDay} getAllDayEventsForDay={getAllDayEventsForDay} fetchAllDayEvents={fetchAllDayEvents}
          setAllDayFormDate={setAllDayFormDate} setShowAllDayForm={setShowAllDayForm}
          timeGridRef={timeGridRef} timeScrollRef={timeScrollRef} dayGridRef={dayGridRef}
          blockProps={blockProps}
        />
      )}
      {viewMode === 'week' && (
        <WeekView
          weekDays={weekDays}
          slotHeight={slotHeight} totalSlots={totalSlots}
          hideOffHours={hideOffHours} visibleStartHour={visibleStartHour} visibleEndHour={visibleEndHour}
          workStartMin={workStartMin} workEndMin={workEndMin}
          currentTime={currentTime} currentUserId={currentUserId}
          getMeetings={getMeetings} getMeetingColor={getMeetingColor}
          isToday={isToday} toFarsiTime={toFarsiTime}
          isDragging={isDragging} dragStartSlot={dragStartSlot} dragEndSlot={dragEndSlot} dragDate={dragDate}
          dragMoveMeeting={dragMoveMeeting} dragMoveOriginalSlot={dragMoveOriginalSlot} dragMoveOriginalEndSlot={dragMoveOriginalEndSlot}
          dragMoveCurrentDeltaSlot={dragMoveCurrentDeltaSlot} dragMoveCurrentDeltaDay={dragMoveCurrentDeltaDay} dragMovedRef={dragMovedRef}
          resizeMeeting={resizeMeeting} resizeOriginalEndSlot={resizeOriginalEndSlot} resizeCurrentDelta={resizeCurrentDelta}
          setDragMoveMeeting={setDragMoveMeeting} setDragMoveStartY={setDragMoveStartY} setDragMoveStartX={setDragMoveStartX}
          setDragMoveOriginalSlot={setDragMoveOriginalSlot} setDragMoveOriginalEndSlot={setDragMoveOriginalEndSlot}
          setDragMoveCurrentDeltaSlot={setDragMoveCurrentDeltaSlot} setDragMoveCurrentDeltaDay={setDragMoveCurrentDeltaDay} setDragMoveOriginalDate={setDragMoveOriginalDate}
          setResizeMeeting={setResizeMeeting} setResizeStartY={setResizeStartY} setResizeOriginalEndSlot={setResizeOriginalEndSlot} setResizeCurrentDelta={setResizeCurrentDelta}
          setPreviewMeeting={setPreviewMeeting}
          handleGridMouseDown={handleGridMouseDown} handleGridMouseMove={handleGridMouseMove}
          handleGridTouchStart={handleGridTouchStart} handleGridTouchMove={handleGridTouchMove}
          commitDrag={commitDrag}
          handleHourColTouchStart={handleHourColTouchStart} handleHourColTouchMove={handleHourColTouchMove} handleHourColTouchEnd={handleHourColTouchEnd}
          adjustSlotHeight={adjustSlotHeight}
          handleEditMeeting={handleEditMeeting} handleBlockClick={handleBlockClick}
          setSelectedJy={setSelectedJy} setSelectedJm={setSelectedJm} setSelectedJd={setSelectedJd} setViewMode={setViewMode}
          getOccasionsForDay={getOccasionsForDay} getAllDayEventsForDay={getAllDayEventsForDay} fetchAllDayEvents={fetchAllDayEvents}
          isInAllDayDragRange={isInAllDayDragRange}
          allDayDragging={allDayDragging} allDayDragStart={allDayDragStart} allDayDragEnd={allDayDragEnd}
          setAllDayDragStart={setAllDayDragStart} setAllDayDragEnd={setAllDayDragEnd} setAllDayDragging={setAllDayDragging}
          setAllDayFormDate={setAllDayFormDate} setAllDayFormEndDate={setAllDayFormEndDate} setShowAllDayForm={setShowAllDayForm}
          timeGridRef={timeGridRef} timeScrollRef={timeScrollRef} weekGridRef={weekGridRef}
          blockProps={blockProps}
        />
      )}
      {viewMode === 'month' && (
        <MonthView
          currentJy={currentJy} currentJm={currentJm}
          mainMonthDays={mainMonthDays}
          getMeetings={getMeetings} getMeetingColor={getMeetingColor}
          isToday={isToday} isSelected={isSelected} toFarsiTime={toFarsiTime}
          getOccasionsForDay={getOccasionsForDay}
          setSelectedJy={setSelectedJy} setSelectedJm={setSelectedJm} setSelectedJd={setSelectedJd}
          setMonthDayPopup={setMonthDayPopup}
          onCreateMeetingForDay={onCreateMeetingForDay}
        />
      )}
      {(viewMode === 'list-week' || viewMode === 'list-month') && (
        <ListView
          listMeetings={listMeetings}
          currentUserId={currentUserId}
          getMeetingColor={getMeetingColor}
          resolveName={resolveName}
          isToday={isToday}
          toFarsiTime={toFarsiTime}
          expandedMeetingId={expandedMeetingId}
          setExpandedMeetingId={setExpandedMeetingId}
          handleEditMeeting={handleEditMeeting}
          listScrollRef={listScrollRef}
        />
      )}
    </>
  );
}
