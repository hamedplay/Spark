import { useEffect, useRef, type RefObject } from 'react';

export function trapOverlayTab(event: KeyboardEvent, panel: HTMLElement) {
  if (event.key !== 'Tab') return;
  const items = Array.from(panel.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'))
    .filter(element => element.getClientRects().length > 0);
  const first = items[0]; const last = items.at(-1);
  if (!first || !last) { event.preventDefault(); panel.focus(); return; }
  const outside = !panel.contains(document.activeElement);
  if (event.shiftKey && (outside || document.activeElement === first || document.activeElement === panel)) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && (outside || document.activeElement === last || document.activeElement === panel)) { event.preventDefault(); first.focus(); }
}
export function useModalFocus(open: boolean, panel: RefObject<HTMLElement | null>, onClose: () => void) {
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    if (!open || !panel.current) return;
    const previous = document.activeElement as HTMLElement | null;
    panel.current.focus({ preventScroll: true });
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); close.current(); }
      else if (panel.current) trapOverlayTab(event, panel.current);
    };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, [open, panel]);
}
