import { useEffect, useRef, useState, type Key, type ReactNode } from 'react';
import { GripVertical } from 'lucide-react';

interface Props<T> {
  items: readonly T[];
  getKey?: (item: T, index: number) => Key;
  onMove: (from: number, to: number) => void;
  disabled?: boolean;
  children: (item: T, index: number, handle: ReactNode) => ReactNode;
}

export function ReorderableAgendaList<T>({ items, getKey, onMove, disabled = false, children }: Props<T>) {
  const listRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ from: number; to: number; x: number; y: number; moved: boolean; count: number } | null>(null);
  const [preview, setPreview] = useState<{ from: number; to: number; x: number; y: number } | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const pointer = useRef({ x: 0, y: 0 });
  const dragging = preview !== null;
  useEffect(() => {
    if (!dragging) return;
    let frame: number;
    const scroll = () => {
      let container = listRef.current?.parentElement;
      while (container && !(/auto|scroll/.test(getComputedStyle(container).overflowY) && container.scrollHeight > container.clientHeight)) container = container.parentElement;
      const bounds = container?.getBoundingClientRect();
      const top = Math.max(0, bounds?.top ?? 0);
      const bottom = Math.min(window.innerHeight, bounds?.bottom ?? window.innerHeight);
      const y = pointer.current.y;
      const delta = y < top + 48 ? -12 : y > bottom - 48 ? 12 : 0;
      if (delta) {
        if (container) container.scrollBy(0, delta);
        else window.scrollBy(0, delta);
      }
      frame = requestAnimationFrame(scroll);
    };
    frame = requestAnimationFrame(scroll);
    return () => cancelAnimationFrame(frame);
  }, [dragging]);
  const canMove = !disabled && items.length > 1;
  const cancel = () => { drag.current = null; setPreview(null); };

  const targetAt = (x: number, y: number) => {
    const row = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-agenda-index]');
    if (!row || row.parentElement !== listRef.current) return null;
    const index = Number(row.dataset.agendaIndex);
    return Number.isInteger(index) && index >= 0 && index < items.length ? index : null;
  };

  const move = (from: number, to: number) => {
    if (!canMove || from === to || to < 0 || to >= items.length) return;
    onMove(from, to);
    setAnnouncement(`بند ${from + 1} به جایگاه ${to + 1} منتقل شد`);
    requestAnimationFrame(() => {
      listRef.current?.querySelector<HTMLButtonElement>(`[data-agenda-index="${to}"] [data-agenda-handle]`)?.focus({ preventScroll: true });
    });
  };

  return (
    <div>
      {canMove && <p className="mb-2 text-xs text-gray-500 dark:text-gray-400">بندها را از دستگیره بکشید؛ ترتیب با ذخیره فرم ثبت می‌شود.</p>}
      <div ref={listRef} className="space-y-2">
        {items.map((item, index) => (
          <div key={getKey?.(item, index) ?? index} data-agenda-index={index}
            className={`rounded-xl ${preview?.from === index ? 'opacity-50' : ''} ${preview?.to === index ? 'ring-2 ring-blue-400 ring-offset-2 dark:ring-offset-gray-800' : ''}`}>
            {children(item, index, (
              <button type="button" data-agenda-handle disabled={!canMove}
                aria-label={`جابه‌جایی بند ${index + 1}`}
                title="برای جابه‌جایی بکشید یا از کلیدهای بالا و پایین استفاده کنید"
                className="shrink-0 rounded-lg p-1.5 text-gray-400 hover:bg-blue-50 hover:text-blue-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-default disabled:opacity-30 dark:hover:bg-blue-900/20"
                style={{ touchAction: 'none', cursor: canMove ? 'grab' : undefined }}
                onPointerDown={event => {
                  if (!canMove || !event.isPrimary || event.button !== 0) return;
                  event.preventDefault();
                  event.currentTarget.focus({ preventScroll: true });
                  event.currentTarget.setPointerCapture(event.pointerId);
                  drag.current = { from: index, to: index, x: event.clientX, y: event.clientY, moved: false, count: items.length };
                }}
                onPointerMove={event => {
                  const current = drag.current;
                  if (!current || !canMove) return;
                  if (Math.hypot(event.clientX - current.x, event.clientY - current.y) > 6) current.moved = true;
                  if (!current.moved) return;
                  pointer.current = { x: event.clientX, y: event.clientY };
                  const target = targetAt(event.clientX, event.clientY);
                  if (target !== null) current.to = target;
                  setPreview({ from: current.from, to: current.to, x: event.clientX, y: event.clientY });
                }}
                onPointerUp={event => {
                  const current = drag.current;
                  const target = targetAt(event.clientX, event.clientY);
                  cancel();
                  if (current?.moved && current.count === items.length && target !== null) move(current.from, target);
                }}
                onPointerCancel={cancel}
                onLostPointerCapture={cancel}
                onKeyDown={event => {
                  if (event.key === 'Escape') { cancel(); return; }
                  if (!canMove || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
                  event.preventDefault();
                  move(index, index + (event.key === 'ArrowUp' ? -1 : 1));
                }}>
                <GripVertical className="h-4 w-4" aria-hidden="true" />
              </button>
            ))}
          </div>
        ))}
      </div>
      <span role="status" aria-live="polite" className="sr-only">{announcement}</span>
      {preview && <div aria-hidden="true" className="pointer-events-none fixed z-[9999] rounded-lg bg-blue-600 px-3 py-2 text-xs text-white shadow-lg"
        style={{ left: preview.x + 12, top: preview.y + 12 }}>بند {preview.from + 1} ← جایگاه {preview.to + 1}</div>}
    </div>
  );
}
