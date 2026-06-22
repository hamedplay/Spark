import { useState, useRef, useEffect, useCallback } from 'react';

export interface FabPos { x: number; y: number }

const DEFAULT_FAB_SIZE = 44;

function clamp(p: FabPos, size: number): FabPos {
  return {
    x: Math.max(0, Math.min(window.innerWidth - size, p.x)),
    y: Math.max(0, Math.min(window.innerHeight - size, p.y)),
  };
}

function defaultPos(side: 'left' | 'right', size: number): FabPos {
  const x = side === 'left' ? 15 : window.innerWidth - size - 15;
  return { x, y: window.innerHeight - size - 15 };
}

export function useDraggableFab(storageKey: string, side: 'left' | 'right', fabSize = DEFAULT_FAB_SIZE) {
  const [pos, setPos] = useState<FabPos>(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const p = JSON.parse(saved) as FabPos;
        if (typeof p.x === 'number' && typeof p.y === 'number') return clamp(p, fabSize);
      }
    } catch {}
    return defaultPos(side, fabSize);
  });

  const isDragging = useRef(false);
  const didDrag = useRef(false);
  const startMouse = useRef<FabPos>({ x: 0, y: 0 });
  const startPos = useRef<FabPos>({ x: 0, y: 0 });

  useEffect(() => {
    const onMove = (e: MouseEvent | TouchEvent) => {
      if (!isDragging.current) return;
      const client = 'touches' in e ? e.touches[0] : e;
      const dx = client.clientX - startMouse.current.x;
      const dy = client.clientY - startMouse.current.y;
      if (!didDrag.current && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) {
        didDrag.current = true;
      }
      if (didDrag.current) {
        setPos(clamp({ x: startPos.current.x + dx, y: startPos.current.y + dy }, fabSize));
      }
    };

    const onUp = () => {
      if (!isDragging.current) return;
      isDragging.current = false;
      setPos(prev => {
        const clamped = clamp(prev, fabSize);
        try { localStorage.setItem(storageKey, JSON.stringify(clamped)); } catch {}
        return clamped;
      });
      setTimeout(() => { didDrag.current = false; }, 10);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onUp);
    };
  }, [storageKey, fabSize]);

  useEffect(() => {
    const onResize = () => setPos(p => clamp(p, fabSize));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [fabSize]);

  const onDragStart = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    isDragging.current = true;
    didDrag.current = false;
    const client = 'touches' in e ? e.touches[0] : (e as React.MouseEvent);
    startMouse.current = { x: client.clientX, y: client.clientY };
    startPos.current = { ...pos };
    if ('button' in e) e.preventDefault();
  }, [pos]);

  const wasDragged = useCallback(() => didDrag.current, []);

  return { pos, onDragStart, wasDragged };
}

/** Compute where to anchor the open panel relative to the FAB position */
export function panelStyle(
  pos: FabPos,
  panelWidth: number,
  panelHeight: number,
  fabSize = DEFAULT_FAB_SIZE,
): React.CSSProperties {
  const gap = 8;
  const left = Math.max(gap, Math.min(window.innerWidth - panelWidth - gap, pos.x));
  const spaceAbove = pos.y - gap;
  const top = spaceAbove >= panelHeight
    ? pos.y - panelHeight - gap
    : Math.min(pos.y + fabSize + gap, window.innerHeight - panelHeight - gap);
  return { position: 'fixed', top, left, zIndex: 60, width: panelWidth };
}
