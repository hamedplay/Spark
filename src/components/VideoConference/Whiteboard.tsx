import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Trash2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import type { WhiteboardStroke } from './types';

const COLORS = ['#00d4aa', '#3b82f6', '#ef4444', '#f59e0b', '#ec4899', '#ffffff', '#374151', '#000000'];

interface WhiteboardProps {
  roomId: string;
  userId: string;
  isHost?: boolean;
}

function safeUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function Whiteboard({ roomId, userId, isHost = false }: WhiteboardProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [tool, setTool] = useState<'pen' | 'eraser'>('pen');
  const [color, setColor] = useState('#00d4aa');
  const [width, setWidth] = useState(4);
  const [isClearing, setIsClearing] = useState(false);
  const drawing = useRef(false);
  const currentPath = useRef<{ x: number; y: number }[]>([]);
  // last drawn point index — for incremental drawing (fix #2)
  const lastDrawnIdx = useRef(0);

  const getPos = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left) / rect.width * canvas.width,
      y: (clientY - rect.top) / rect.height * canvas.height,
    };
  };

  const drawStroke = useCallback((ctx: CanvasRenderingContext2D, stroke: WhiteboardStroke) => {
    if (stroke.points.length < 2) return;
    ctx.globalCompositeOperation = stroke.tool === 'eraser' ? 'destination-out' : 'source-over';
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
    stroke.points.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
    ctx.stroke();
  }, []);

  // fix #2: draw only the NEW segment since last call instead of the full path
  const drawSegment = useCallback((ctx: CanvasRenderingContext2D, points: { x: number; y: number }[], fromIdx: number, strokeTool: 'pen' | 'eraser', strokeColor: string, strokeWidth: number) => {
    if (fromIdx < 1 || fromIdx >= points.length) return;
    ctx.globalCompositeOperation = strokeTool === 'eraser' ? 'destination-out' : 'source-over';
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = strokeWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(points[fromIdx - 1].x, points[fromIdx - 1].y);
    ctx.lineTo(points[fromIdx].x, points[fromIdx].y);
    ctx.stroke();
  }, []);

  const clearCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (ctx && canvas) ctx.clearRect(0, 0, canvas.width, canvas.height);
  }, []);

  const startDraw = (x: number, y: number) => {
    drawing.current = true;
    currentPath.current = [getPos(x, y)];
    lastDrawnIdx.current = 0;
  };

  const moveDraw = (x: number, y: number) => {
    if (!drawing.current) return;
    const pos = getPos(x, y);

    // Throttle: skip if less than 2px from last point
    const last = currentPath.current[currentPath.current.length - 1];
    if (last && Math.hypot(pos.x - last.x, pos.y - last.y) < 2) return;

    currentPath.current.push(pos);
    const ctx = canvasRef.current?.getContext('2d');
    const idx = currentPath.current.length - 1;
    // fix #2: only draw the newest segment
    if (ctx && idx >= 1) {
      drawSegment(ctx, currentPath.current, idx, tool, color, width);
      lastDrawnIdx.current = idx;
    }
  };

  const endDraw = async () => {
    if (!drawing.current || currentPath.current.length < 2) { drawing.current = false; return; }
    const stroke: WhiteboardStroke = {
      id: safeUUID(), userId, points: [...currentPath.current], color, width, tool,
    };
    drawing.current = false;
    currentPath.current = [];
    lastDrawnIdx.current = 0;
    const { error } = await supabase.from('conference_whiteboard').insert({ room_id: roomId, user_id: userId, stroke_data: stroke });
    if (error) console.error('whiteboard insert error:', error);
  };

  useEffect(() => {
    const load = async () => {
      const { data, error } = await supabase
        .from('conference_whiteboard')
        .select('stroke_data')
        .eq('room_id', roomId)
        .order('created_at');

      // fix #3: only render if load succeeded
      if (error) { console.error('whiteboard load error:', error); return; }
      const ctx = canvasRef.current?.getContext('2d');
      if (!ctx || !data) return;
      clearCanvas();
      data.forEach(({ stroke_data }) => drawStroke(ctx, stroke_data as WhiteboardStroke));
    };

    load();

    const ch = supabase.channel(`wb-${roomId}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'conference_whiteboard', filter: `room_id=eq.${roomId}` },
        ({ new: row }) => {
          const ctx = canvasRef.current?.getContext('2d');
          // Don't redraw our own strokes — already painted live during moveDraw
          if (ctx && row.stroke_data?.userId !== userId) {
            drawStroke(ctx, row.stroke_data as WhiteboardStroke);
          }
        })
      // fix #1: listen for DELETE events so all clients clear when board is wiped
      .on('postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'conference_whiteboard', filter: `room_id=eq.${roomId}` },
        () => { clearCanvas(); })
      // fix #1 (broadcast fallback): immediate clear via broadcast before DB delete propagates
      .on('broadcast', { event: 'wb_clear' }, () => { clearCanvas(); })
      .subscribe();

    return () => { ch.unsubscribe(); };
  }, [roomId, userId, drawStroke, clearCanvas]);

  // fix #1 + #3 + #5: clear with moderation check, broadcast first, then delete
  const clearBoard = async () => {
    if (!isHost) return; // moderation: only host can clear all
    setIsClearing(true);
    try {
      // Broadcast immediate clear to all clients before DB round-trip
      const broadcastCh = supabase.channel(`wb-${roomId}`);
      broadcastCh.send({ type: 'broadcast', event: 'wb_clear', payload: { by: userId } });

      const { error } = await supabase
        .from('conference_whiteboard')
        .delete()
        .eq('room_id', roomId);

      // fix #3: only clear local canvas after confirmed delete
      if (error) {
        console.error('whiteboard clear error:', error);
      } else {
        clearCanvas();
      }
    } finally {
      setIsClearing(false);
    }
  };

  return (
    <div className="flex flex-col h-full gap-2 p-2">
      <div className="flex items-center gap-2 flex-wrap flex-shrink-0">
        <div className="flex gap-1 bg-gray-800 rounded-xl p-1">
          {(['pen', 'eraser'] as const).map(t => (
            <button key={t} onClick={() => setTool(t)}
              aria-label={t === 'pen' ? 'ابزار قلم' : 'ابزار پاک‌کن'}
              aria-pressed={tool === t}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${tool === t ? 'bg-teal-600 text-white' : 'text-gray-400 hover:text-white'}`}>
              {t === 'pen' ? 'قلم' : 'پاک‌کن'}
            </button>
          ))}
        </div>
        <div className="flex gap-1.5" role="group" aria-label="انتخاب رنگ">
          {COLORS.map(c => (
            <button key={c} onClick={() => setColor(c)}
              aria-label={`رنگ ${c}`}
              aria-pressed={color === c}
              className={`w-6 h-6 rounded-full border-2 transition-transform ${color === c ? 'border-white scale-125' : 'border-transparent'}`}
              style={{ background: c }} />
          ))}
        </div>
        <select value={width} onChange={e => setWidth(Number(e.target.value))}
          aria-label="ضخامت قلم"
          className="bg-gray-800 text-white text-xs rounded-lg px-2 py-1.5 border border-gray-700">
          {[2, 4, 8, 14, 20].map(w => <option key={w} value={w}>{w}px</option>)}
        </select>
        {/* fix #5: clear only visible/enabled for host */}
        {isHost && (
          <button onClick={clearBoard} disabled={isClearing} aria-label="پاک کردن تخته سفید"
            className="p-1.5 bg-red-900/40 hover:bg-red-900/60 disabled:opacity-50 text-red-400 rounded-lg transition-colors">
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>
      <div className="flex-1 rounded-xl overflow-hidden bg-white min-h-0">
        <canvas
          ref={canvasRef}
          width={1200}
          height={700}
          aria-label="تخته سفید مشترک"
          role="img"
          className="w-full h-full"
          style={{ cursor: tool === 'eraser' ? 'cell' : 'crosshair', touchAction: 'none' }}
          onMouseDown={e => startDraw(e.clientX, e.clientY)}
          onMouseMove={e => moveDraw(e.clientX, e.clientY)}
          onMouseUp={endDraw}
          onMouseLeave={endDraw}
          onTouchStart={e => {
            if (e.touches.length !== 1) return;
            e.preventDefault();
            startDraw(e.touches[0].clientX, e.touches[0].clientY);
          }}
          onTouchMove={e => {
            if (e.touches.length !== 1) return;
            e.preventDefault();
            moveDraw(e.touches[0].clientX, e.touches[0].clientY);
          }}
          onTouchEnd={e => { e.preventDefault(); endDraw(); }}
        />
      </div>
    </div>
  );
}
