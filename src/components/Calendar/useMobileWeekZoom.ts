import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CalendarViewProps } from './CalendarViewTypes';
import { clampWeekZoom, weekZoomHeight, fitWeekSlotHeight } from './weekZoom';

// Only resize events and completed pinches enter React. Touch moves update two
// inherited CSS variables at most once per animation frame, without rerendering meetings.
export function useMobileWeekZoom(p: CalendarViewProps) {
  const [width, setWidth] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [timeHeight, setTimeHeight] = useState(0);
  const live = useRef(p);
  live.current = p;
  const committed = useRef(1);
  const enabled = p.viewMode === 'week' && width > 0 && width < 768
    && window.matchMedia('(max-width: 767px)').matches;
  useLayoutEffect(() => {
    committed.current = zoom;
    const el = p.timeScrollRef.current;
    el?.style.setProperty('--calendar-week-x', '1');
    el?.style.setProperty('--calendar-week-y', '1');
  }, [zoom, enabled, p.slotHeight, p.timeScrollRef]);

  useLayoutEffect(() => {
    const el = p.timeScrollRef.current;
    if (!el) return;
    const header = el.querySelector<HTMLElement>('[data-week-header]');
    const measure = () => {
      if (el.dataset.weekPinching === 'true') return;
      setWidth(el.clientWidth);
      setTimeHeight(Math.max(0, el.clientHeight - (header?.offsetHeight || 0) - 2));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    if (header) observer.observe(header);
    measure();
    return () => observer.disconnect();
  }, [p.timeScrollRef]);


  useLayoutEffect(() => {
    if (!enabled || zoom !== 1 || !timeHeight || p.timeScrollRef.current?.dataset.weekPinching === 'true') return;
    const start = Math.max(p.visibleStartHour * 60, p.workStartMin);
    const end = Math.min(p.visibleEndHour * 60, p.workEndMin);
    const fitted = fitWeekSlotHeight(timeHeight, start, end);
    if (fitted === null) return;
    if (Math.abs(p.slotHeight - fitted) > 0.05) {
      p.adjustSlotHeight(fitted - p.slotHeight);
    }
  }, [enabled, zoom, timeHeight, p.slotHeight, p.workStartMin, p.workEndMin, p.visibleStartHour, p.visibleEndHour]);

  useEffect(() => {
    const el = p.timeScrollRef.current;
    if (!el || !enabled) return;
    let frame = 0;
    let suppressUntil = 0;
    let gesture: null | {
      distance: number; base: number; value: number; right: number; top: number;
      x: number; y: number; header: number; slotHeight: number;
    } = null;
    let draining = false;
    const prevent = (event: TouchEvent) => {
      if (event.cancelable) event.preventDefault();
      event.stopImmediatePropagation();
    };
    const paint = () => {
      frame = 0;
      if (!gesture) return;
      const g = gesture;
      const x = g.value / g.base;
      const y = weekZoomHeight(g.value / g.base, g.slotHeight, 4) / g.slotHeight;
      el.style.setProperty('--calendar-week-x', String(x));
      el.style.setProperty('--calendar-week-y', String(y));
      // RTL scrollLeft is zero at the right edge and negative toward later columns.
      el.scrollLeft = g.right - 56 - g.x * x;
      el.scrollTop = g.y * y + g.header - g.top;
    };
    const start = (event: TouchEvent) => {
      if (draining) { prevent(event); return; }
      if (event.touches.length !== 2) {
        return;
      }
      // Cancel a first-finger long press before claiming the two-finger gesture.
      event.target?.dispatchEvent(new Event('touchcancel', { bubbles: true }));
      const props = live.current;
      props.setDragMoveMeeting(null);
      props.setResizeMeeting(null);
      props.setAllDayDragging(false);
      props.cancelTouchDrag?.();
      props.handleHourColTouchEnd();
      prevent(event);
      const [a, b] = Array.from(event.touches);
      const rect = el.getBoundingClientRect();
      const right = rect.right - (a.clientX + b.clientX) / 2;
      const top = (a.clientY + b.clientY) / 2 - rect.top;
      const header = el.querySelector<HTMLElement>('[data-week-header]')?.offsetHeight || 0;
      const base = committed.current;
      gesture = {
        distance: Math.max(1, Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)),
        base, value: base, right, top, header, slotHeight: props.slotHeight,
        x: Math.max(0, right - 56 - el.scrollLeft),
        y: el.scrollTop + top - header,
      };
      draining = true;
      el.dataset.weekPinching = 'true';
    };
    const move = (event: TouchEvent) => {
      if (!draining) return;
      prevent(event);
      if (!gesture || event.touches.length !== 2) return;
      const [a, b] = Array.from(event.touches);
      const rect = el.getBoundingClientRect();
      gesture.right = rect.right - (a.clientX + b.clientX) / 2;
      gesture.top = (a.clientY + b.clientY) / 2 - rect.top;
      gesture.value = clampWeekZoom(gesture.base * Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) / gesture.distance);
      if (!frame) frame = requestAnimationFrame(paint);
    };
    const end = (event: TouchEvent) => {
      if (!draining) return;
      prevent(event);
      if (gesture) {
        if (frame) cancelAnimationFrame(frame);
        paint();
        const value = gesture.value;
        const height = weekZoomHeight(value / gesture.base, gesture.slotHeight, 4);
        live.current.adjustSlotHeight(height - live.current.slotHeight);
        gesture = null;
        // Persist the final geometry; unchanged gestures only need CSS cleanup.
        setZoom(value);
        if (value === committed.current) {
          el.style.setProperty('--calendar-week-x', '1');
          el.style.setProperty('--calendar-week-y', '1');
        }
      }
      suppressUntil = Date.now() + 400;
      if (event.type === 'touchcancel' || event.touches.length === 0) {
        draining = false;
        delete el.dataset.weekPinching;
      }
    };
    const step = (event: Event) => {
      if (draining) return;
      const delta = Number((event as CustomEvent<{ delta?: number }>).detail?.delta || 0);
      if (!delta) return;
      const props = live.current;
      const header = el.querySelector<HTMLElement>('[data-week-header]')?.offsetHeight || 0;
      const right = 56 + (el.clientWidth - 56) / 2;
      const top = header + (el.clientHeight - header) / 2;
      const base = committed.current;
      const value = clampWeekZoom(base * (delta > 0 ? 1.25 : 1 / 1.25));
      if (value === base) return;
      gesture = { distance: 1, base, value, right, top, header, slotHeight: props.slotHeight,
        x: Math.max(0, right - 56 - el.scrollLeft), y: el.scrollTop + top - header };
      draining = true;
      paint();
      end({ touches: [], cancelable: false, stopImmediatePropagation() {} } as unknown as TouchEvent);
    };
    const click = (event: MouseEvent) => {
      if (draining || Date.now() < suppressUntil) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    window.addEventListener('spark-calendar-mobile-week-zoom', step);
    const options = { capture: true, passive: false };
    el.addEventListener('touchstart', start, options);
    el.addEventListener('touchmove', move, options);
    el.addEventListener('touchend', end, options);
    el.addEventListener('touchcancel', end, options);
    el.addEventListener('click', click, true);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('spark-calendar-mobile-week-zoom', step);
      el.removeEventListener('touchstart', start, true);
      el.removeEventListener('touchmove', move, true);
      el.removeEventListener('touchend', end, true);
      el.removeEventListener('touchcancel', end, true);
      el.removeEventListener('click', click, true);
      el.style.removeProperty('--calendar-week-x');
      el.style.removeProperty('--calendar-week-y');
      delete el.dataset.weekPinching;
    };
  }, [enabled, p.timeScrollRef]);

  return { enabled, zoom, dayWidth: Math.max(1, (width - 56) / 7) * zoom };
}
