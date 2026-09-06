import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { ChevronLeft, ChevronRight, Crosshair, Eraser, Expand, Loader2, Minus, MousePointer2, PenLine, Plus } from 'lucide-react';
import type {
  ConferencePresentationAnnotationElement,
  ConferencePresentationItem,
  ConferencePresentationLaser,
  ConferencePresentationPoint,
} from '../../types/conference.types';

interface Props {
  presentation: ConferencePresentationItem;
  url: string;
  page: number;
  canManage: boolean;
  canAnnotate: boolean;
  annotationElements: ConferencePresentationAnnotationElement[];
  lasers: ConferencePresentationLaser[];
  busy: boolean;
  onNavigate: (page: number) => Promise<boolean>;
  onPersistStroke: (element: ConferencePresentationAnnotationElement) => Promise<boolean>;
  onClear: () => Promise<boolean>;
  onLaser: (x: number, y: number) => void;
}

const pointsString = (points: ConferencePresentationPoint[]) =>
  points.map((point) => `${point.x},${point.y}`).join(' ');

function AnnotationElement({ element }: { element: ConferencePresentationAnnotationElement }) {
  const points = element.points;
  if (points.length === 0) return null;

  const stroke = element.color || '#ef4444';
  const width = element.width || 4;

  if (element.type === 'pen' || element.type === 'marker') {
    return (
      <polyline
        points={pointsString(points)}
        fill="none"
        stroke={stroke}
        strokeWidth={width}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={element.type === 'marker' ? 0.45 : 1}
      />
    );
  }

  if (element.type === 'line' || element.type === 'arrow') {
    const [start, end] = points;
    if (!end) return null;
    return (
      <line
        x1={start.x}
        y1={start.y}
        x2={end.x}
        y2={end.y}
        stroke={stroke}
        strokeWidth={width}
        markerEnd={element.type === 'arrow' ? 'url(#presentation-arrow)' : undefined}
      />
    );
  }

  if (element.type === 'rectangle' || element.type === 'sticky') {
    const [start, end] = points;
    if (!end) return null;
    return (
      <rect
        x={Math.min(start.x, end.x)}
        y={Math.min(start.y, end.y)}
        width={Math.abs(end.x - start.x)}
        height={Math.abs(end.y - start.y)}
        fill={element.type === 'sticky' ? '#fef3c7' : 'transparent'}
        stroke={stroke}
        strokeWidth={width}
      />
    );
  }

  if (element.type === 'circle') {
    const [start, end] = points;
    if (!end) return null;
    return (
      <ellipse
        cx={(start.x + end.x) / 2}
        cy={(start.y + end.y) / 2}
        rx={Math.abs(end.x - start.x) / 2}
        ry={Math.abs(end.y - start.y) / 2}
        fill="none"
        stroke={stroke}
        strokeWidth={width}
      />
    );
  }

  if (element.type === 'text') {
    return (
      <text x={points[0].x} y={points[0].y} fill={stroke} fontSize="28">
        {element.text || ''}
      </text>
    );
  }

  return null;
}

export function ConferencePresentationViewer({
  presentation,
  url,
  page,
  canManage,
  canAnnotate,
  annotationElements,
  lasers,
  busy,
  onNavigate,
  onPersistStroke,
  onClear,
  onLaser,
}: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [zoom, setZoom] = useState(100);
  const [mode, setMode] = useState<'view' | 'annotate' | 'laser'>('view');
  const [draft, setDraft] = useState<ConferencePresentationPoint[] | null>(null);
  const [pageInput, setPageInput] = useState(String(page));
  const [documentUrl, setDocumentUrl] = useState<string | null>(null);
  const [documentError, setDocumentError] = useState('');
  const [localLaser, setLocalLaser] = useState<ConferencePresentationPoint | null>(null);
  const maxPage = presentation.pageCount || 1000;

  useEffect(() => {
    setPageInput(String(page));
    setDraft(null);
    setLocalLaser(null);
  }, [page]);

  useEffect(() => {
    if (mode !== 'laser') setLocalLaser(null);
    if (mode !== 'annotate') setDraft(null);
  }, [mode]);

  useEffect(() => {
    if (presentation.sourceKind === 'IMAGE') {
      setDocumentUrl(null);
      setDocumentError('');
      return undefined;
    }

    let cancelled = false;
    let objectUrl: string | null = null;
    setDocumentUrl(null);
    setDocumentError('');

    void fetch(url)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`PRESENTATION_FETCH_${response.status}`);
        }
        const blob = await response.blob();
        if (blob.size <= 0) throw new Error('PRESENTATION_EMPTY_FILE');
        return blob;
      })
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setDocumentUrl(objectUrl);
      })
      .catch((error) => {
        console.error('[VideoConference] presentation document load failed', error);
        if (!cancelled) {
          setDocumentError('نمایش فایل ارائه ناموفق بود. فایل را دوباره انتخاب کنید.');
        }
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [presentation.sourceKind, url]);

  const mediaUrl = useMemo(() => {
    if (presentation.sourceKind === 'IMAGE') return url;
    if (!documentUrl) return '';
    return `${documentUrl}#page=${page}&toolbar=0&navpanes=0&scrollbar=0&view=FitH`;
  }, [documentUrl, page, presentation.sourceKind, url]);

  const toggleFullscreen = async () => {
    const element = rootRef.current;
    if (!element?.requestFullscreen) return;

    try {
      if (document.fullscreenElement === element) {
        await document.exitFullscreen();
        return;
      }
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      }
      await element.requestFullscreen();
    } catch (error) {
      console.error('[VideoConference] presentation fullscreen toggle failed', error);
    }
  };

  const pointFromEvent = (event: ReactPointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1000, ((event.clientX - rect.left) / rect.width) * 1000)),
      y: Math.max(0, Math.min(1000, ((event.clientY - rect.top) / rect.height) * 1000)),
    };
  };

  const handlePointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    const point = pointFromEvent(event);
    if (mode === 'annotate' && canAnnotate) {
      event.currentTarget.setPointerCapture(event.pointerId);
      setDraft([point]);
    } else if (mode === 'laser' && canAnnotate) {
      setLocalLaser(point);
      onLaser(point.x, point.y);
    }
  };

  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const point = pointFromEvent(event);
    if (mode === 'laser' && canAnnotate) {
      setLocalLaser(point);
      onLaser(point.x, point.y);
      return;
    }
    if (mode === 'annotate' && draft) {
      setDraft((current) => current ? [...current, point].slice(-2000) : current);
    }
  };

  const finishStroke = async () => {
    if (!draft || draft.length < 2) {
      setDraft(null);
      return;
    }
    const points = draft;
    setDraft(null);
    await onPersistStroke({
      id: crypto.randomUUID(),
      type: 'pen',
      points,
      color: '#ef4444',
      width: 4,
    });
  };

  const goToPage = (value: number) => {
    const target = Math.max(1, Math.min(maxPage, Math.floor(value)));
    setPageInput(String(target));
    void onNavigate(target);
  };

  return (
    <div ref={rootRef} className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-white/10 bg-slate-950">
      <div className="flex flex-wrap items-center gap-1 border-b border-white/10 px-2 py-2 text-xs">
        <button onClick={() => goToPage(page - 1)} disabled={!canManage || busy || page <= 1} className="rounded-lg p-2 hover:bg-white/10 disabled:opacity-30" aria-label="صفحه قبل"><ChevronRight className="h-4 w-4" /></button>
        <form onSubmit={(event) => { event.preventDefault(); goToPage(Number(pageInput)); }} className="flex items-center gap-1">
          <input value={pageInput} onChange={(event) => setPageInput(event.target.value.replace(/\D/g, '').slice(0, 4))} disabled={!canManage} className="w-14 rounded-lg border border-white/10 bg-slate-900 px-2 py-1.5 text-center disabled:opacity-60" aria-label="شماره صفحه" />
          <span className="text-slate-400">/ {presentation.pageCount || '؟'}</span>
        </form>
        <button onClick={() => goToPage(page + 1)} disabled={!canManage || busy || page >= maxPage} className="rounded-lg p-2 hover:bg-white/10 disabled:opacity-30" aria-label="صفحه بعد"><ChevronLeft className="h-4 w-4" /></button>
        <span className="mx-1 h-5 w-px bg-white/10" />
        <button onClick={() => setZoom((value) => Math.max(50, value - 10))} className="rounded-lg p-2 hover:bg-white/10" aria-label="کاهش بزرگنمایی"><Minus className="h-4 w-4" /></button>
        <span className="min-w-10 text-center">{zoom}%</span>
        <button onClick={() => setZoom((value) => Math.min(200, value + 10))} className="rounded-lg p-2 hover:bg-white/10" aria-label="افزایش بزرگنمایی"><Plus className="h-4 w-4" /></button>
        <button onClick={() => void toggleFullscreen()} className="rounded-lg p-2 hover:bg-white/10" aria-label="تغییر حالت تمام صفحه"><Expand className="h-4 w-4" /></button>

        {canAnnotate && (
          <>
            <span className="mx-1 h-5 w-px bg-white/10" />
            <button onClick={() => setMode('view')} className={`rounded-lg p-2 ${mode === 'view' ? 'bg-sky-600' : 'hover:bg-white/10'}`} aria-label="حالت مشاهده"><MousePointer2 className="h-4 w-4" /></button>
            <button onClick={() => setMode('annotate')} className={`rounded-lg p-2 ${mode === 'annotate' ? 'bg-rose-600' : 'hover:bg-white/10'}`} aria-label="حاشیه‌نویسی"><PenLine className="h-4 w-4" /></button>
            <button onClick={() => setMode('laser')} className={`rounded-lg p-2 ${mode === 'laser' ? 'bg-amber-500 text-slate-950' : 'hover:bg-white/10'}`} aria-label="نشانگر لیزری"><Crosshair className="h-4 w-4" /></button>
            {canManage && <button onClick={() => void onClear()} disabled={busy} className="rounded-lg p-2 text-rose-300 hover:bg-white/10 disabled:opacity-30" aria-label="پاک کردن حاشیه‌نویسی"><Eraser className="h-4 w-4" /></button>}
          </>
        )}
      </div>

      <div className="relative min-h-0 flex-1 overflow-auto bg-black/40">
        <div className="absolute inset-0 flex items-center justify-center overflow-hidden">
          <div className="relative h-full w-full origin-center" style={{ transform: `scale(${zoom / 100})` }}>
            {presentation.sourceKind === 'IMAGE'
              ? <img src={mediaUrl} alt={presentation.title} className="h-full w-full object-contain" draggable={false} />
              : documentError
                ? <div className="flex h-full w-full items-center justify-center bg-slate-900 p-6 text-center text-sm text-rose-200">{documentError}</div>
                : !mediaUrl
                  ? <div className="flex h-full w-full items-center justify-center bg-slate-900 text-slate-300"><Loader2 className="h-6 w-6 animate-spin" /></div>
                  : <iframe key={mediaUrl} src={mediaUrl} title={presentation.title} className="h-full w-full border-0 bg-white" allow="fullscreen" />}

            <svg
              viewBox="0 0 1000 1000"
              preserveAspectRatio="none"
              className={`absolute inset-0 z-10 h-full w-full touch-none ${mode === 'view' ? 'pointer-events-none' : 'cursor-crosshair'}`}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={() => {
                if (mode === 'laser') {
                  setLocalLaser(null);
                } else {
                  void finishStroke();
                }
              }}
              onPointerCancel={() => {
                setDraft(null);
                setLocalLaser(null);
              }}
              onPointerLeave={() => {
                if (mode === 'laser') setLocalLaser(null);
              }}
            >
              <defs>
                <marker id="presentation-arrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
                  <path d="M0,0 L0,6 L8,3 z" fill="#ef4444" />
                </marker>
              </defs>
              {annotationElements.map((element) => <AnnotationElement key={element.id} element={element} />)}
              {draft && <polyline points={pointsString(draft)} fill="none" stroke="#ef4444" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />}
              {lasers.map((laser) => (
                <g key={laser.participantIdentity} transform={`translate(${laser.x} ${laser.y})`}>
                  <circle r="12" fill="#ef4444" />
                  <text x="18" y="-14" fill="white" fontSize="24" stroke="black" strokeWidth="3" paintOrder="stroke">{laser.displayName}</text>
                </g>
              ))}
              {localLaser && <circle cx={localLaser.x} cy={localLaser.y} r="12" fill="#ef4444" />}
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}
