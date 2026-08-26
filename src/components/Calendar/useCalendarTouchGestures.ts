import { useCallback, useEffect, useRef } from 'react';
import type React from 'react';
import type { CalendarViewProps } from './CalendarViewTypes';

type CalendarDate = { jy: number; jm: number; jd: number };

const LONG_PRESS_MS = 180;
const MOVE_CANCEL_PX = 12;
const SWIPE_THRESHOLD_PX = 64;

export function useCalendarTouchGestures(p: CalendarViewProps, enableHorizontalNavigation: boolean) {
  const holdTimerRef = useRef<number | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const longPressActiveRef = useRef(false);
  const pinchActiveRef = useRef(false);
  const swipeTriggeredRef = useRef(false);

  const clearHoldTimer = useCallback(() => {
    if (holdTimerRef.current !== null) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  }, []);

  const resetGesture = useCallback(() => {
    clearHoldTimer();
    startRef.current = null;
    longPressActiveRef.current = false;
    pinchActiveRef.current = false;
    swipeTriggeredRef.current = false;
  }, [clearHoldTimer]);

  // Keep the calendar viewport from visually rubber-banding at its scroll edges on
  // mobile Safari while preserving ordinary one-finger scrolling inside the viewport.
  useEffect(() => {
    const scrollEl = p.timeScrollRef.current;
    if (!scrollEl) return;

    const previousOverscrollBehavior = scrollEl.style.overscrollBehavior;
    scrollEl.style.overscrollBehavior = 'none';

    return () => {
      scrollEl.style.overscrollBehavior = previousOverscrollBehavior;
    };
  }, [p.timeScrollRef, p.viewMode]);

  // iOS Safari can claim the gesture for native scrolling before React's synthetic
  // touchmove preventDefault runs. Keep normal scrolling enabled until the deliberate
  // long press activates, then block the native default for the rest of that gesture.
  useEffect(() => {
    const preventNativeScrollDuringDrag = (event: TouchEvent) => {
      if (!longPressActiveRef.current || !event.cancelable) return;
      event.preventDefault();
    };

    document.addEventListener('touchmove', preventNativeScrollDuringDrag, { passive: false });
    return () => document.removeEventListener('touchmove', preventNativeScrollDuringDrag);
  }, []);

  const handleTouchStart = useCallback((e: React.TouchEvent, date: CalendarDate) => {
    clearHoldTimer();

    if (e.touches.length === 2) {
      startRef.current = null;
      longPressActiveRef.current = false;
      pinchActiveRef.current = true;
      swipeTriggeredRef.current = false;
      p.handleHourColTouchStart(e);
      return;
    }

    if (e.touches.length !== 1) return;

    const touch = e.touches[0];
    startRef.current = { x: touch.clientX, y: touch.clientY };
    longPressActiveRef.current = false;
    pinchActiveRef.current = false;
    swipeTriggeredRef.current = false;

    // A short tap or scroll belongs to navigation. Empty-grid meeting creation only
    // activates after a brief deliberate hold, avoiding accidental creation on touch.
    holdTimerRef.current = window.setTimeout(() => {
      if (!startRef.current || pinchActiveRef.current || swipeTriggeredRef.current) return;
      longPressActiveRef.current = true;
      p.handleGridTouchStart(e, date.jy, date.jm, date.jd);
    }, LONG_PRESS_MS);
  }, [clearHoldTimer, p]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      clearHoldTimer();
      startRef.current = null;
      longPressActiveRef.current = false;
      pinchActiveRef.current = true;
      p.handleHourColTouchMove(e);
      return;
    }

    if (e.touches.length !== 1) return;

    if (longPressActiveRef.current) {
      p.handleGridTouchMove(e);
      return;
    }

    const start = startRef.current;
    if (!start) return;

    const touch = e.touches[0];
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);

    if (absX > MOVE_CANCEL_PX || absY > MOVE_CANCEL_PX) clearHoldTimer();

    if (
      enableHorizontalNavigation &&
      !swipeTriggeredRef.current &&
      absX >= SWIPE_THRESHOLD_PX &&
      absX > absY * 1.25
    ) {
      swipeTriggeredRef.current = true;
      clearHoldTimer();
      e.preventDefault();
      window.dispatchEvent(new CustomEvent('spark-calendar-mobile-navigate', {
        detail: { direction: dx < 0 ? 'next' : 'prev' },
      }));
    }
  }, [clearHoldTimer, enableHorizontalNavigation, p]);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    clearHoldTimer();

    if (pinchActiveRef.current) {
      p.handleHourColTouchEnd();
      resetGesture();
      return;
    }

    // Suppress compatibility mouse events that some mobile/PWA browsers emit after
    // touchend; otherwise they can immediately trigger the desktop grid mouse path.
    e.preventDefault();

    if (longPressActiveRef.current) {
      p.commitDrag();
    }

    resetGesture();
  }, [clearHoldTimer, p, resetGesture]);

  const handleTouchCancel = useCallback(() => {
    if (pinchActiveRef.current) p.handleHourColTouchEnd();
    resetGesture();
  }, [p, resetGesture]);

  return {
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
    handleTouchCancel,
  };
}
