import type { PointerEvent, WheelEvent } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  ConferenceWhiteboardElement,
  ConferenceWhiteboardPage,
  ConferenceWhiteboardPoint,
  ConferenceWhiteboardPresence,
  ConferenceWhiteboardTool,
} from '../../types/conference.types';
import {
  hitTestConferenceWhiteboardElement,
  renderConferenceWhiteboardElement,
} from '../../utils/conferenceWhiteboardGeometry';

interface Props {
  page: ConferenceWhiteboardPage;
  tool: ConferenceWhiteboardTool;
  color: string;
  width: number;
  zoom: number;
  pan: ConferenceWhiteboardPoint;
  canEdit: boolean;
  presence: ConferenceWhiteboardPresence[];
  assetUrls: Record<string, string>;
  onPanChange: (pan: ConferenceWhiteboardPoint) => void;
  onZoomChange: (zoom: number) => void;
  onCreateElement: (element: ConferenceWhiteboardElement) => Promise<void>;
  onDeleteElement: (element: ConferenceWhiteboardElement) => Promise<void>;
  onPresence: (point: ConferenceWhiteboardPoint, laser: boolean) => void;
}

type TextDraft = {
  type: 'text' | 'sticky';
  world: ConferenceWhiteboardPoint;
  screen: ConferenceWhiteboardPoint;
};

function safeId() {
  return crypto.randomUUID();
}

export function ConferenceWhiteboardCanvas({
  page,
  tool,
  color,
  width,
  zoom,
  pan,
  canEdit,
  presence,
  assetUrls,
  onPanChange,
  onZoomChange,
  onCreateElement,
  onDeleteElement,
  onPresence,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageCacheRef = useRef(new Map<string, HTMLImageElement>());
  const [draft, setDraft] = useState<ConferenceWhiteboardElement | null>(null);
  const [textDraft, setTextDraft] = useState<TextDraft | null>(null);
  const [textValue, setTextValue] = useState('');
  const [imageTick, setImageTick] = useState(0);
  const pointerIdRef = useRef<number | null>(null);
  const startRef = useRef<ConferenceWhiteboardPoint | null>(null);
  const panStartRef = useRef<{
    pointer: ConferenceWhiteboardPoint;
    pan: ConferenceWhiteboardPoint;
  } | null>(null);

  const elements = page.snapshot.elements;

  useEffect(() => {
    for (const element of elements) {
      if (element.type !== 'image' || !element.assetPath) continue;
      const url = assetUrls[element.assetPath];
      if (!url || imageCacheRef.current.has(element.assetPath)) continue;
      const image = new Image();
      image.onload = () => setImageTick((value) => value + 1);
      image.src = url;
      imageCacheRef.current.set(element.assetPath, image);
    }
  }, [assetUrls, elements]);

  const worldPoint = (clientX: number, clientY: number): ConferenceWhiteboardPoint => {
    const rect = containerRef.current!.getBoundingClientRect();
    return {
      x: (clientX - rect.left - pan.x) / zoom,
      y: (clientY - rect.top - pan.y) / zoom,
    };
  };

  const screenPoint = (world: ConferenceWhiteboardPoint): ConferenceWhiteboardPoint => ({
    x: world.x * zoom + pan.x,
    y: world.y * zoom + pan.y,
  });

  const resizeAndRender = () => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const rect = container.getBoundingClientRect();
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const widthPx = Math.max(1, Math.floor(rect.width * dpr));
    const heightPx = Math.max(1, Math.floor(rect.height * dpr));
    if (canvas.width !== widthPx || canvas.height !== heightPx) {
      canvas.width = widthPx;
      canvas.height = heightPx;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, rect.width, rect.height);

    ctx.save();
    ctx.translate(pan.x, pan.y);
    ctx.scale(zoom, zoom);

    for (const element of elements) {
      const image = element.assetPath
        ? imageCacheRef.current.get(element.assetPath)
        : undefined;
      renderConferenceWhiteboardElement(ctx, element, image);
    }
    if (draft) renderConferenceWhiteboardElement(ctx, draft);
    ctx.restore();

    for (const item of presence) {
      const screen = screenPoint({ x: item.x, y: item.y });
      ctx.save();
      ctx.globalAlpha = item.laser ? 0.95 : 0.85;
      ctx.fillStyle = item.laser ? '#ef4444' : '#0f172a';
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, item.laser ? 9 : 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = '11px Vazirmatn, sans-serif';
      const label = item.displayName.slice(0, 40);
      const labelWidth = ctx.measureText(label).width + 12;
      ctx.fillStyle = item.laser ? '#7f1d1d' : '#1e293b';
      ctx.fillRect(screen.x + 8, screen.y + 8, labelWidth, 20);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(label, screen.x + 14, screen.y + 22);
      ctx.restore();
    }
  };

  useEffect(() => {
    resizeAndRender();
    const observer = new ResizeObserver(resizeAndRender);
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [draft, elements, imageTick, pan.x, pan.y, presence, zoom]);

  const commitText = async () => {
    const current = textDraft;
    const text = textValue.trim();
    setTextDraft(null);
    setTextValue('');
    if (!current || !text || !canEdit) return;

    const end = current.type === 'sticky'
      ? { x: current.world.x + 220, y: current.world.y + 150 }
      : undefined;

    await onCreateElement({
      id: safeId(),
      type: current.type,
      points: end ? [current.world, end] : [current.world],
      color,
      width,
      text,
    });
  };

  const onPointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    const point = worldPoint(event.clientX, event.clientY);
    onPresence(point, tool === 'laser');

    if (tool === 'pan' || !canEdit) {
      pointerIdRef.current = event.pointerId;
      panStartRef.current = {
        pointer: { x: event.clientX, y: event.clientY },
        pan,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }

    if (tool === 'laser') return;

    if (tool === 'text' || tool === 'sticky') {
      const rect = containerRef.current!.getBoundingClientRect();
      setTextDraft({
        type: tool,
        world: point,
        screen: {
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
        },
      });
      setTextValue('');
      return;
    }

    if (tool === 'eraser') {
      const hit = [...elements].reverse().find((element) =>
        hitTestConferenceWhiteboardElement(element, point, 12 / zoom));
      if (hit) void onDeleteElement(hit);
      return;
    }

    pointerIdRef.current = event.pointerId;
    startRef.current = point;
    event.currentTarget.setPointerCapture(event.pointerId);

    setDraft({
      id: safeId(),
      type: tool,
      points: [point],
      color,
      width,
    });
  };

  const onPointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    const point = worldPoint(event.clientX, event.clientY);
    onPresence(point, tool === 'laser');

    if (panStartRef.current && pointerIdRef.current === event.pointerId) {
      onPanChange({
        x: panStartRef.current.pan.x
          + event.clientX - panStartRef.current.pointer.x,
        y: panStartRef.current.pan.y
          + event.clientY - panStartRef.current.pointer.y,
      });
      return;
    }

    if (!draft || pointerIdRef.current !== event.pointerId) return;

    if (draft.type === 'pen' || draft.type === 'marker') {
      const last = draft.points[draft.points.length - 1];
      if (Math.hypot(point.x - last.x, point.y - last.y) < 1.5 / zoom) return;
      setDraft({ ...draft, points: [...draft.points, point].slice(-2000) });
    } else {
      setDraft({ ...draft, points: [startRef.current || point, point] });
    }
  };

  const finishPointer = (event: PointerEvent<HTMLCanvasElement>) => {
    if (pointerIdRef.current !== event.pointerId) return;

    if (panStartRef.current) {
      panStartRef.current = null;
      pointerIdRef.current = null;
      return;
    }

    const finalDraft = draft;
    setDraft(null);
    startRef.current = null;
    pointerIdRef.current = null;
    if (finalDraft && canEdit) void onCreateElement(finalDraft);
  };

  const onWheel = (event: WheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    const rect = containerRef.current!.getBoundingClientRect();
    const cursor = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
    const before = {
      x: (cursor.x - pan.x) / zoom,
      y: (cursor.y - pan.y) / zoom,
    };
    const nextZoom = Math.max(
      0.25,
      Math.min(4, zoom * (event.deltaY > 0 ? 0.9 : 1.1)),
    );
    onZoomChange(nextZoom);
    onPanChange({
      x: cursor.x - before.x * nextZoom,
      y: cursor.y - before.y * nextZoom,
    });
  };

  const cursor = useMemo(() => {
    if (!canEdit || tool === 'pan') return 'grab';
    if (tool === 'text') return 'text';
    if (tool === 'eraser') return 'cell';
    if (tool === 'laser') return 'crosshair';
    return 'crosshair';
  }, [canEdit, tool]);

  return (
    <div ref={containerRef} className="relative min-h-0 flex-1 overflow-hidden rounded-xl bg-white">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full touch-none"
        style={{ cursor }}
        aria-label="تخته سفید مشترک"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finishPointer}
        onPointerCancel={finishPointer}
        onWheel={onWheel}
      />

      {textDraft && (
        <form
          className="absolute z-20 min-w-52 rounded-xl border border-slate-300 bg-white p-2 shadow-2xl"
          style={{ left: textDraft.screen.x, top: textDraft.screen.y }}
          onSubmit={(event) => {
            event.preventDefault();
            void commitText();
          }}
        >
          <textarea
            autoFocus
            value={textValue}
            onChange={(event) => setTextValue(event.target.value.slice(0, 1000))}
            rows={textDraft.type === 'sticky' ? 4 : 2}
            placeholder={textDraft.type === 'sticky' ? 'متن یادداشت…' : 'متن…'}
            className="w-full resize-none rounded-lg border border-slate-200 px-2 py-1.5 text-sm text-slate-900 outline-none focus:border-cyan-500"
          />
          <div className="mt-2 flex justify-end gap-1">
            <button
              type="button"
              onClick={() => {
                setTextDraft(null);
                setTextValue('');
              }}
              className="rounded-lg px-2 py-1 text-xs text-slate-500"
            >
              لغو
            </button>
            <button
              type="submit"
              disabled={!textValue.trim()}
              className="rounded-lg bg-cyan-600 px-3 py-1 text-xs font-bold text-white disabled:opacity-50"
            >
              ثبت
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
