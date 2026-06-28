import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Trash2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';
import type { WhiteboardStroke, Point } from './types';

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
  const currentPath = useRef<Point[]>([]);
  // fix #1: hold the subscribed channel so clearBoard can reuse it for broadcast
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const getPos = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left) / rect.width * canvas.width,
      y: (clientY - rect.top) / rect.height * canvas.height,
    };
  };

  const drawStroke = useCallback((ctx: CanvasRenderingContext2D, stroke: WhiteboardStroke) => {
    if (!stroke.points.length) return;
    ctx.globalCompositeOperation = stroke.tool === 'eraser' ? 'destination-out' : 'source-over';
    ctx.strokeStyle = stroke.color;
    ctx.fillStyle = stroke.color;
    ctx.lineWidth = stroke.width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // fix #3: single-point tap → draw a dot instead of silently doing nothing
    if (stroke.points.length === 1) {
      ctx.beginPath();
      ctx.arc(stroke.points[0].x, stroke.points[0].y, stroke.width / 2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    ctx.beginPath();
    ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
    stroke.points.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
    ctx.stroke();
  }, []);

  const drawSegment = useCallback((ctx: CanvasRenderingContext2D, points: Point[], fromIdx: number, strokeTool: 'pen' | 'eraser', strokeColor: string, strokeWidth: number) => {
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
    if (ctx && idx >= 1) {
      drawSegment(ctx, currentPath.current, idx, tool, color, width);
    }
  };

  // fix #4: show toast when stroke fails to persist
  const endDraw = async () => {
    if (!drawing.current || !currentPath.current.length) { drawing.current = false; return; }

    // fix #3: allow single-point strokes (dots)
    const stroke: WhiteboardStroke = {
      id: safeUUID(), userId, points: [...currentPath.current], color, width, tool,
    };
    drawing.current = false;
    currentPath.current = [];

    // Draw dot for single-point tap (not yet drawn by moveDraw)
    if (stroke.points.length === 1) {
      const ctx = canvasRef.current?.getContext('2d');
      if (ctx) drawStroke(ctx, stroke);
    }

    const { error } = await supabase.from('conference_whiteboard').insert({
      room_id: roomId, user_id: userId, stroke_data: stroke,
    });
    if (error) {
      console.error('whiteboard insert error:', error);
      toast.error('خطا در ذخیره stroke — تغییر فقط برای شما نمایش داده می‌شود');
    }
  };

  useEffect(() => {
    const load = async () => {
      const { data, error } = await supabase
        .from('conference_whiteboard')
        .select('stroke_data')
        .eq('room_id', roomId)
        .order('created_at');

      if (error) { console.error('whiteboard load error:', error); return; }
      const ctx = canvasRef.current?.getContext('2d');
      if (!ctx || !data) return;
      clearCanvas();
      data.forEach(({ stroke_data }) => drawStroke(ctx, stroke_data as WhiteboardStroke));
    };

    load();

    // fix #1: keep a ref to the subscribed channel so clearBoard can reuse it
    const ch = supabase.channel(`wb-${roomId}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'conference_whiteboard', filter: `room_id=eq.${roomId}` },
        ({ new: row }) => {
          const ctx = canvasRef.current?.getContext('2d');
          if (ctx && row.stroke_data?.userId !== userId) {
            drawStroke(ctx, row.stroke_data as WhiteboardStroke);
          }
        })
      .on('postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'conference_whiteboard', filter: `room_id=eq.${roomId}` },
        () => { clearCanvas(); })
      // fix #5: reset drawing state on remote clear to prevent ghost strokes
      .on('broadcast', { event: 'wb_clear' }, () => {
        drawing.current = false;
        currentPath.current = [];
        clearCanvas();
      })
      .subscribe();

    channelRef.current = ch;

    return () => {
      ch.unsubscribe();
      channelRef.current = null;
    };
  }, [roomId, userId, drawStroke, clearCanvas]);

  // fix #1: reuse the already-subscribed channel for broadcast
  const clearBoard = async () => {
    if (!isHost) return;
    setIsClearing(true);
    try {
      // Broadcast immediate clear to all clients before DB round-trip
      channelRef.current?.send({ type: 'broadcast', event: 'wb_clear', payload: { by: userId } });

      const { error } = await supabase
        .from('conference_whiteboard')
        .delete()
        .eq('room_id', roomId);

      if (error) {
        console.error('whiteboard clear error:', error);
        toast.error('خطا در پاک کردن تخته');
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
        {isHost && (
          <button onClick={clearBoard} disabled={isClearing} aria-label="پاک کردن تخته سفید"
            className="p-1.5 bg-red-900/40 hover:bg-red-900/60 disabled:opacity-50 text-red-400 rounded-lg transition-colors">
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* fix #2: center canvas and maintain 1200:700 aspect ratio to prevent stroke distortion */}
      <div className="flex-1 min-h-0 flex items-center justify-center bg-white rounded-xl overflow-hidden">
        <canvas
          ref={canvasRef}
          width={1200}
          height={700}
          aria-label="تخته سفید مشترک"
          role="img"
          className="max-w-full max-h-full"
          style={{ aspectRatio: '1200/700', cursor: tool === 'eraser' ? 'cell' : 'crosshair', touchAction: 'none' }}
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
