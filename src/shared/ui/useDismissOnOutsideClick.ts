import { useEffect } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';

export function useDismissOnOutsideClick<T, E extends HTMLElement>(active: boolean, ref: RefObject<E | null>, setOpen: Dispatch<SetStateAction<T | null>>) {
  useEffect(() => {
    if (!active) return;
    const handleMouseDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(null);
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [active, ref, setOpen]);
}
