import React, { useState, useEffect, useRef, useCallback, useReducer } from 'react';
import {
  Trash2, Undo2, Redo2, Type, Minus, Square, Circle as CircleIcon,
  ArrowRight, Pen, Eraser,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';
import type { WhiteboardStroke, Point } from './types';

// ─── History state ────────────────────────────────────────────────────────────
type BoardEntry = { stroke: WhiteboardStroke; dbRowId?: string; isOwn: boolean };
type BoardState = { entries: BoardEntry[]; redoStack: BoardEntry[] };
type BoardAction =
  | { type: 'ADD_OWN'; stroke: WhiteboardStroke; dbRowId?: string }
  | { type: 'ADD_OWN_FROM_REDO'; stroke: WhiteboardStroke; dbRowId?: string }
  | { type: 'ADD_REMOTE'; stroke: WhiteboardStroke }
  | { type: 'UNDO' }
  | { type: 'POP_REDO' }
  | { type: 'CLEAR_ALL' }
  | { type: 'REMOVE_DB_ROW'; dbRowId: string }
  | { type: 'LOAD'; rows: BoardEntry[] };

function boardReducer(s: BoardState, a: BoardAction): BoardState {
  switch (a.type) {
    case 'ADD_OWN':
      return { entries: [...s.entries, { stroke: a.stroke, dbRowId: a.dbRowId, isOwn: true }], redoStack: [] };
    case 'ADD_OWN_FROM_REDO':
      return { entries: [...s.entries, { stroke: a.stroke, dbRowId: a.dbRowId, isOwn: true }], redoStack: s.redoStack };
    case 'ADD_REMOTE':
      return { ...s, entries: [...s.entries, { stroke: a.stroke, isOwn: false }] };
    case 'UNDO': {
      const ownIndices = s.entries.map((e, i) => e.isOwn ? i : -1).filter(i => i !== -1);
      if (!ownIndices.length) return s;
      const idx = ownIndices[ownIndices.length - 1];
      return { entries: s.entries.filter((_, i) => i !== idx), redoStack: [...s.redoStack, s.entries[idx]] };
    }
    case 'POP_REDO':
      return { ...s, redoStack: s.redoStack.slice(0, -1) };
    case 'CLEAR_ALL':
      return { entries: [], redoStack: [] };
    case 'REMOVE_DB_ROW':
      return { ...s, entries: s.entries.filter(e => e.dbRowId !== a.dbRowId) };
    case 'LOAD':
      return { entries: a.rows, redoStack: [] };
    default:
      return s;
  }
}

// ─── Drawing helpers ──────────────────────────────────────────────────────────
const COLORS = ['#000000', '#ef4444', '#3b82f6', '#22c55e', '#eab308', '#a855f7'];
const WIDTHS = [2, 4, 8, 14, 20];
// محدودیت‌های اعتبارسنجی برای جلوگیری از DoS رندر
const MAX_POINTS = 2000;
const MAX_TEXT_LEN = 500;
const VALID_TOOLS = new Set(['pen', 'eraser', 'line', 'rect', 'circle', 'arrow', 'text']);
const VALID_COLORS = new Set(COLORS);
const MIN_WIDTH = 1;
const MAX_WIDTH = 40;

function safeUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// اعتبارسنجی stroke دریافتی از ریموت — جلوگیری از DoS یا تزریق داده مخرب
function validateStroke(data: unknown): WhiteboardStroke | null {
  if (!data || typeof data !== 'object') return null;
  const s = data as Record<string, unknown>;
  if (typeof s.id !== 'string' || typeof s.userId !== 'string') return null;
  if (!VALID_TOOLS.has(s.tool as string)) return null;
  if (!Array.isArray(s.points) || s.points.length > MAX_POINTS) return null;
  if (typeof s.color !== 'string' || !VALID_COLORS.has(s.color)) return null;
  if (typeof s.width !== 'number' || s.width < MIN_WIDTH || s.width > MAX_WIDTH) return null;
  if (s.text !== undefined && (typeof s.text !== 'string' || s.text.length > MAX_TEXT_LEN)) return null;
  return s as unknown as WhiteboardStroke;
}

function drawArrowHead(ctx: CanvasRenderingContext2D, from: Point, to: Point, width: number) {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const head = Math.max(width * 4, 14);
  ctx.beginPath();
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(to.x - head * Math.cos(angle - Math.PI / 6), to.y - head * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(to.x - head * Math.cos(angle + Math.PI / 6), to.y - head * Math.sin(angle + Math.PI / 6));
  ctx.closePath();
  ctx.fill();
}

function renderStroke(ctx: CanvasRenderingContext2D, stroke: WhiteboardStroke) {
  if (!stroke.points.length) return;
  const [p0, p1] = stroke.points;
  ctx.save();
  ctx.globalCompositeOperation = stroke.tool === 'eraser' ? 'destination-out' : 'source-over';
  ctx.strokeStyle = stroke.color;
  ctx.fillStyle = stroke.color;
  ctx.lineWidth = stroke.width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  switch (stroke.tool) {
    case 'pen':
    case 'eraser':
      if (stroke.points.length === 1) {
        ctx.beginPath(); ctx.arc(p0.x, p0.y, stroke.width / 2, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.beginPath(); ctx.moveTo(p0.x, p0.y);
        stroke.points.slice(1).forEach(p => ctx.lineTo(p.x, p.y)); ctx.stroke();
      }
      break;
    case 'line':
      if (!p1) break;
      ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke(); break;
    case 'rect':
      if (!p1) break;
      ctx.beginPath(); ctx.strokeRect(p0.x, p0.y, p1.x - p0.x, p1.y - p0.y); break;
    case 'circle':
      if (!p1) break;
      ctx.beginPath();
      ctx.ellipse(
        p0.x + (p1.x - p0.x) / 2, p0.y + (p1.y - p0.y) / 2,
        Math.abs(p1.x - p0.x) / 2, Math.abs(p1.y - p0.y) / 2,
        0, 0, Math.PI * 2,
      );
      ctx.stroke(); break;
    case 'arrow':
      if (!p1) break;
      ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();
      drawArrowHead(ctx, p0, p1, stroke.width); break;
    case 'text':
      if (!stroke.text) break;
      ctx.font = `${Math.max(stroke.width * 5, 16)}px Vazirmatn, sans-serif`;
      ctx.fillText(stroke.text, p0.x, p0.y); break;
  }
  ctx.restore();
}

// ─── Component ────────────────────────────────────────────────────────────────
interface WhiteboardProps {
  roomId: string;
  userId: string;
  isHost?: boolean;
}

export function Whiteboard({ roomId, userId, isHost = false }: WhiteboardProps) {
  const mainRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [tool, setTool] = useState<WhiteboardStroke['tool']>('pen');
  const [color, setColor] = useState('#000000');
  const [width, setWidth] = useState(4);
  const [isClearing, setIsClearing] = useState(false);

  const [board, dispatch] = useReducer(boardReducer, { entries: [], redoStack: [] });
  const boardRef = useRef(board);
  boardRef.current = board;

  const drawing = useRef(false);
  const startPt = useRef<Point | null>(null);
  const penPath = useRef<Point[]>([]);

  const [textPos, setTextPos] = useState<{ sx: number; sy: number; cx: number; cy: number } | null>(null);
  const [textInput, setTextInput] = useState('');
  const textInputRef = useRef<HTMLInputElement>(null);
  // جلوگیری از درج دوتایی متن (Enter + onBlur هر دو commitText صدا می‌زنند)
  const committedRef = useRef(false);

  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const toolRef = useRef(tool); toolRef.current = tool;
  const colorRef = useRef(color); colorRef.current = color;
  const widthRef = useRef(width); widthRef.current = width;

  // ─── Canvas utils ──────────────────────────────────────────────────────────
  const getPos = (clientX: number, clientY: number): Point => {
    const c = mainRef.current!; const r = c.getBoundingClientRect();
    return { x: (clientX - r.left) / r.width * c.width, y: (clientY - r.top) / r.height * c.height };
  };

  const redrawMain = useCallback(() => {
    const c = mainRef.current; const ctx = c?.getContext('2d');
    if (!ctx || !c) return;
    ctx.clearRect(0, 0, c.width, c.height);
    boardRef.current.entries.forEach(e => renderStroke(ctx, e.stroke));
  }, []);

  const clearOverlay = useCallback(() => {
    const c = overlayRef.current; const ctx = c?.getContext('2d');
    if (ctx && c) ctx.clearRect(0, 0, c.width, c.height);
  }, []);

  useEffect(() => { redrawMain(); }, [board, redrawMain]);

  // ─── Load + realtime ───────────────────────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      // user_id را هم select می‌کنیم تا echo-suppression سروری باشد، نه از stroke_data
      const { data, error } = await supabase
        .from('conference_whiteboard')
        .select('id, stroke_data, user_id')
        .eq('room_id', roomId)
        .order('created_at');
      if (error) { console.error('whiteboard load error:', error); return; }
      if (data) dispatch({
        type: 'LOAD',
        rows: data.map(r => {
          const stroke = validateStroke(r.stroke_data);
          if (!stroke) return null;
          return { stroke, dbRowId: r.id, isOwn: r.user_id === userId };
        }).filter((e): e is BoardEntry => e !== null),
      });
    };
    load();

    const ch = supabase.channel(`wb-${roomId}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'conference_whiteboard', filter: `room_id=eq.${roomId}` },
        ({ new: row }) => {
          // echo-suppression: بر اساس ستون واقعی user_id، نه stroke_data.userId
          if (row.user_id === userId) return;
          const stroke = validateStroke(row.stroke_data);
          if (stroke) dispatch({ type: 'ADD_REMOTE', stroke });
        })
      .on('postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'conference_whiteboard', filter: `room_id=eq.${roomId}` },
        ({ old: row }) => {
          if (row.id) dispatch({ type: 'REMOVE_DB_ROW', dbRowId: row.id });
          else dispatch({ type: 'CLEAR_ALL' });
        })
      .on('broadcast', { event: 'wb_clear' }, () => {
        drawing.current = false; penPath.current = []; startPt.current = null;
        clearOverlay(); dispatch({ type: 'CLEAR_ALL' });
      })
      .subscribe();

    channelRef.current = ch;
    return () => { supabase.removeChannel(ch); channelRef.current = null; };
  }, [roomId, userId, clearOverlay]);

  // ─── Persist own stroke ────────────────────────────────────────────────────
  const saveStroke = useCallback(async (stroke: WhiteboardStroke) => {
    // رندر بلافاصله روی canvas اصلی (optimistic)
    renderStroke(mainRef.current!.getContext('2d')!, stroke);
    const { data, error } = await supabase
      .from('conference_whiteboard')
      .insert({ room_id: roomId, user_id: userId, stroke_data: stroke })
      .select('id').single();
    if (error) { toast.error('خطا در ذخیره'); dispatch({ type: 'ADD_OWN', stroke }); }
    else dispatch({ type: 'ADD_OWN', stroke, dbRowId: data.id });
  }, [roomId, userId]);

  // ─── Undo / Redo ──────────────────────────────────────────────────────────
  const handleUndo = useCallback(async () => {
    const own = boardRef.current.entries.filter(e => e.isOwn);
    if (!own.length) return;
    const last = own[own.length - 1];
    dispatch({ type: 'UNDO' });
    if (last.dbRowId) await supabase.from('conference_whiteboard').delete().eq('id', last.dbRowId);
  }, []);

  const handleRedo = useCallback(async () => {
    const top = boardRef.current.redoStack[boardRef.current.redoStack.length - 1];
    if (!top) return;
    dispatch({ type: 'POP_REDO' });
    const { data, error } = await supabase
      .from('conference_whiteboard')
      .insert({ room_id: roomId, user_id: userId, stroke_data: top.stroke })
      .select('id').single();
    dispatch({ type: 'ADD_OWN_FROM_REDO', stroke: top.stroke, dbRowId: error ? undefined : data?.id });
  }, [roomId, userId]);

  // ─── Host clear ────────────────────────────────────────────────────────────
  const clearBoard = async () => {
    if (!isHost) return;
    setIsClearing(true);
    try {
      channelRef.current?.send({ type: 'broadcast', event: 'wb_clear', payload: { by: userId } });
      const { error } = await supabase.from('conference_whiteboard').delete().eq('room_id', roomId);
      if (error) toast.error('خطا در پاک کردن تخته');
      else { dispatch({ type: 'CLEAR_ALL' }); clearOverlay(); }
    } finally { setIsClearing(false); }
  };

  // ─── Pointer events ────────────────────────────────────────────────────────
  const isShape = (t: WhiteboardStroke['tool']) =>
    t === 'line' || t === 'rect' || t === 'circle' || t === 'arrow';

  const onDown = (clientX: number, clientY: number) => {
    if (toolRef.current === 'text') {
      const pos = getPos(clientX, clientY);
      const cr = containerRef.current!.getBoundingClientRect();
      committedRef.current = false;
      setTextPos({ sx: clientX - cr.left, sy: clientY - cr.top, cx: pos.x, cy: pos.y });
      setTextInput('');
      setTimeout(() => textInputRef.current?.focus(), 30);
      return;
    }
    drawing.current = true;
    startPt.current = getPos(clientX, clientY);
    penPath.current = [startPt.current];
  };

  const onMove = (clientX: number, clientY: number) => {
    if (!drawing.current) return;
    const pos = getPos(clientX, clientY);
    if (isShape(toolRef.current)) {
      const c = overlayRef.current; const ctx = c?.getContext('2d');
      if (!ctx || !c || !startPt.current) return;
      ctx.clearRect(0, 0, c.width, c.height);
      renderStroke(ctx, {
        id: 'preview', userId,
        points: [startPt.current, pos],
        color: colorRef.current, width: widthRef.current, tool: toolRef.current,
      });
    } else {
      const last = penPath.current[penPath.current.length - 1];
      if (last && Math.hypot(pos.x - last.x, pos.y - last.y) < 2) return;
      const c = overlayRef.current; const ctx = c?.getContext('2d');
      if (ctx && last) {
        ctx.save();
        ctx.globalCompositeOperation = toolRef.current === 'eraser' ? 'destination-out' : 'source-over';
        ctx.strokeStyle = colorRef.current; ctx.lineWidth = widthRef.current;
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(pos.x, pos.y); ctx.stroke();
        ctx.restore();
      }
      penPath.current.push(pos);
    }
  };

  const onUp = async (clientX: number, clientY: number) => {
    if (!drawing.current) return;
    drawing.current = false;
    clearOverlay();
    const pos = getPos(clientX, clientY);
    let stroke: WhiteboardStroke;
    if (isShape(toolRef.current)) {
      if (!startPt.current) return;
      stroke = { id: safeUUID(), userId, points: [startPt.current, pos], color: colorRef.current, width: widthRef.current, tool: toolRef.current };
    } else {
      const path = [...penPath.current]; penPath.current = [];
      if (!path.length) return;
      stroke = { id: safeUUID(), userId, points: path, color: colorRef.current, width: widthRef.current, tool: toolRef.current };
    }
    startPt.current = null;
    await saveStroke(stroke);
  };

  // وقتی ماوس از canvas خارج می‌شود، stroke را finalize می‌کنیم (نه discard)
  const onLeave = (clientX: number, clientY: number) => {
    if (!drawing.current) return;
    onUp(clientX, clientY);
  };

  const commitText = async () => {
    // guard: از درج دوتایی جلوگیری می‌کنیم (Enter + onBlur)
    if (committedRef.current) return;
    committedRef.current = true;
    if (!textInput.trim() || !textPos) { setTextPos(null); return; }
    const stroke: WhiteboardStroke = {
      id: safeUUID(), userId,
      points: [{ x: textPos.cx, y: textPos.cy }],
      color, width, tool: 'text', text: textInput.trim(),
    };
    setTextPos(null); setTextInput('');
    await saveStroke(stroke);
  };

  // ─── Toolbar ───────────────────────────────────────────────────────────────
  const tools: { t: WhiteboardStroke['tool']; icon: React.ReactNode; label: string }[] = [
    { t: 'pen',    icon: <Pen className="w-4 h-4" />,        label: 'قلم' },
    { t: 'eraser', icon: <Eraser className="w-4 h-4" />,     label: 'پاک‌کن' },
    { t: 'line',   icon: <Minus className="w-4 h-4" />,      label: 'خط' },
    { t: 'rect',   icon: <Square className="w-4 h-4" />,     label: 'مستطیل' },
    { t: 'circle', icon: <CircleIcon className="w-4 h-4" />, label: 'بیضی' },
    { t: 'arrow',  icon: <ArrowRight className="w-4 h-4" />, label: 'فلش' },
    { t: 'text',   icon: <Type className="w-4 h-4" />,       label: 'متن' },
  ];

  const canUndo = board.entries.some(e => e.isOwn);
  const canRedo = board.redoStack.length > 0;

  return (
    <div className="flex flex-col h-full gap-2 p-2">
      {/* Toolbar */}
      <div className="flex items-center gap-1.5 flex-wrap flex-shrink-0 bg-gray-800/60 rounded-xl p-1.5">
        <button onClick={handleUndo} disabled={!canUndo} aria-label="لغو" title="Undo"
          className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-700 disabled:opacity-30 transition-colors">
          <Undo2 className="w-4 h-4" />
        </button>
        <button onClick={handleRedo} disabled={!canRedo} aria-label="تکرار" title="Redo"
          className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-700 disabled:opacity-30 transition-colors">
          <Redo2 className="w-4 h-4" />
        </button>
        <div className="w-px h-5 bg-gray-600" />
        {tools.map(({ t, icon, label }) => (
          <button key={t} onClick={() => setTool(t)} aria-label={label} aria-pressed={tool === t} title={label}
            className={`p-1.5 rounded-lg transition-colors ${tool === t ? 'bg-teal-600 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-700'}`}>
            {icon}
          </button>
        ))}
        <div className="w-px h-5 bg-gray-600" />
        <div className="flex gap-1" role="group" aria-label="رنگ">
          {COLORS.map(c => (
            <button key={c} onClick={() => setColor(c)} aria-pressed={color === c} title={c}
              className={`w-5 h-5 rounded-full border-2 transition-transform ${color === c ? 'border-white scale-125' : 'border-gray-600 hover:scale-110'}`}
              style={{ background: c }} />
          ))}
        </div>
        <div className="w-px h-5 bg-gray-600" />
        <select value={width} onChange={e => setWidth(Number(e.target.value))} aria-label="ضخامت"
          className="bg-gray-700 text-white text-xs rounded-lg px-2 py-1 border border-gray-600 outline-none">
          {WIDTHS.map(w => <option key={w} value={w}>{w}px</option>)}
        </select>
        {isHost && (
          <button onClick={clearBoard} disabled={isClearing} aria-label="پاک کردن تخته"
            className="p-1.5 bg-red-900/40 hover:bg-red-900/60 disabled:opacity-40 text-red-400 rounded-lg transition-colors ml-auto">
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Canvas */}
      <div ref={containerRef} className="relative flex-1 min-h-0 bg-white rounded-xl overflow-hidden">
        {/* canvas اصلی — stroke‌های نهایی */}
        <canvas ref={mainRef} width={1200} height={700}
          className="absolute inset-0 w-full h-full" />
        {/* canvas overlay — preview در حال رسم */}
        <canvas ref={overlayRef} width={1200} height={700}
          aria-label="تخته سفید مشترک" role="img"
          className="absolute inset-0 w-full h-full z-10"
          style={{ cursor: tool === 'eraser' ? 'cell' : tool === 'text' ? 'text' : 'crosshair', touchAction: 'none' }}
          onMouseDown={e => onDown(e.clientX, e.clientY)}
          onMouseMove={e => onMove(e.clientX, e.clientY)}
          onMouseUp={e => onUp(e.clientX, e.clientY)}
          onMouseLeave={e => onLeave(e.clientX, e.clientY)}
          onTouchStart={e => { if (e.touches.length !== 1) return; e.preventDefault(); onDown(e.touches[0].clientX, e.touches[0].clientY); }}
          onTouchMove={e => { if (e.touches.length !== 1) return; e.preventDefault(); onMove(e.touches[0].clientX, e.touches[0].clientY); }}
          onTouchEnd={e => { e.preventDefault(); if (e.changedTouches.length) onUp(e.changedTouches[0].clientX, e.changedTouches[0].clientY); }}
        />
        {/* input شناور برای متن */}
        {textPos && (
          <div className="absolute z-20" style={{ left: textPos.sx, top: textPos.sy, transform: 'translate(0,-50%)' }}>
            <input
              ref={textInputRef}
              value={textInput}
              onChange={e => setTextInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); commitText(); }
                if (e.key === 'Escape') { committedRef.current = true; setTextPos(null); setTextInput(''); }
              }}
              onBlur={commitText}
              placeholder="متن..."
              maxLength={MAX_TEXT_LEN}
              className="border-2 border-teal-500 rounded-lg px-2 py-1 outline-none shadow-lg min-w-[120px]"
              style={{ color, fontSize: `${Math.max(width * 5, 16)}px`, background: 'rgba(255,255,255,0.95)' }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
