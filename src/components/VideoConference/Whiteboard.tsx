import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Trash2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import type { WhiteboardStroke } from './types';

const COLORS = ['#00d4aa', '#3b82f6', '#ef4444', '#f59e0b', '#ec4899', '#ffffff', '#374151', '#000000'];

interface WhiteboardProps {
  roomId: string;
  userId: string;
}

export function Whiteboard({ roomId, userId }: WhiteboardProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [tool, setTool] = useState<'pen' | 'eraser'>('pen');
  const [color, setColor] = useState('#00d4aa');
  const [width, setWidth] = useState(4);
  const drawing = useRef(false);
  const currentPath = useRef<{ x: number; y: number }[]>([]);

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

  const startDraw = (x: number, y: number) => {
    drawing.current = true;
    currentPath.current = [getPos(x, y)];
  };

  const moveDraw = (x: number, y: number) => {
    if (!drawing.current) return;
    currentPath.current.push(getPos(x, y));
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx && currentPath.current.length >= 2) {
      drawStroke(ctx, { id: '', userId, points: currentPath.current, color, width, tool });
    }
  };

  const endDraw = async () => {
    if (!drawing.current || currentPath.current.length < 2) { drawing.current = false; return; }
    const stroke: WhiteboardStroke = {
      id: crypto.randomUUID(), userId, points: [...currentPath.current], color, width, tool,
    };
    drawing.current = false;
    currentPath.current = [];
    const { error } = await supabase.from('conference_whiteboard').insert({ room_id: roomId, user_id: userId, stroke_data: stroke });
    if (error) console.error('whiteboard insert error:', error);
  };

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase.from('conference_whiteboard').select('stroke_data').eq('room_id', roomId).order('created_at');
      const ctx = canvasRef.current?.getContext('2d');
      if (!ctx || !data) return;
      data.forEach(({ stroke_data }) => drawStroke(ctx, stroke_data as WhiteboardStroke));
    };
    load();
    const ch = supabase.channel(`wb-${roomId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'conference_whiteboard', filter: `room_id=eq.${roomId}` },
        ({ new: row }) => {
          const ctx = canvasRef.current?.getContext('2d');
          if (ctx && row.stroke_data?.userId !== userId) drawStroke(ctx, row.stroke_data as WhiteboardStroke);
        })
      .subscribe();
    return () => { ch.unsubscribe(); };
  }, [roomId, userId, drawStroke]);

  const clearBoard = () => {
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, canvasRef.current!.width, canvasRef.current!.height);
    supabase.from('conference_whiteboard').delete().eq('room_id', roomId).then(() => {});
  };

  return (
    <div className="flex flex-col h-full gap-2 p-2">
      <div className="flex items-center gap-2 flex-wrap flex-shrink-0">
        <div className="flex gap-1 bg-gray-800 rounded-xl p-1">
          {(['pen', 'eraser'] as const).map(t => (
            <button key={t} onClick={() => setTool(t)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${tool === t ? 'bg-teal-600 text-white' : 'text-gray-400 hover:text-white'}`}>
              {t === 'pen' ? 'قلم' : 'پاک‌کن'}
            </button>
          ))}
        </div>
        <div className="flex gap-1.5">
          {COLORS.map(c => (
            <button key={c} onClick={() => setColor(c)}
              className={`w-6 h-6 rounded-full border-2 transition-transform ${color === c ? 'border-white scale-125' : 'border-transparent'}`}
              style={{ background: c }} />
          ))}
        </div>
        <select value={width} onChange={e => setWidth(Number(e.target.value))}
          className="bg-gray-800 text-white text-xs rounded-lg px-2 py-1.5 border border-gray-700">
          {[2, 4, 8, 14, 20].map(w => <option key={w} value={w}>{w}px</option>)}
        </select>
        <button onClick={clearBoard} aria-label="پاک کردن تخته سفید"
          className="p-1.5 bg-red-900/40 hover:bg-red-900/60 text-red-400 rounded-lg transition-colors">
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
      <div className="flex-1 rounded-xl overflow-hidden bg-white min-h-0">
        <canvas
          ref={canvasRef}
          width={1200}
          height={700}
          className="w-full h-full"
          style={{ cursor: tool === 'eraser' ? 'cell' : 'crosshair', touchAction: 'none' }}
          onMouseDown={e => startDraw(e.clientX, e.clientY)}
          onMouseMove={e => moveDraw(e.clientX, e.clientY)}
          onMouseUp={endDraw}
          onMouseLeave={endDraw}
          onTouchStart={e => { e.preventDefault(); startDraw(e.touches[0].clientX, e.touches[0].clientY); }}
          onTouchMove={e => { e.preventDefault(); moveDraw(e.touches[0].clientX, e.touches[0].clientY); }}
          onTouchEnd={e => { e.preventDefault(); endDraw(); }}
        />
      </div>
    </div>
  );
}
