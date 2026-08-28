import type { ReactNode } from 'react';
import { useRef } from 'react';
import {
  ArrowRight,
  Circle,
  Crosshair,
  Eraser,
  Hand,
  Image as ImageIcon,
  Lock,
  Minus,
  Pen,
  Plus,
  Redo2,
  RotateCcw,
  Square,
  StickyNote,
  Trash2,
  Type,
  Undo2,
  Unlock,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type {
  ConferenceWhiteboardPage,
  ConferenceWhiteboardTool,
} from '../../types/conference.types';

interface Props {
  pages: ConferenceWhiteboardPage[];
  selectedPageId: string | null;
  tool: ConferenceWhiteboardTool;
  color: string;
  width: number;
  zoom: number;
  canUse: boolean;
  canEdit: boolean;
  canManage: boolean;
  locked: boolean;
  busy: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onSelectPage: (pageId: string) => void;
  onToolChange: (tool: ConferenceWhiteboardTool) => void;
  onColorChange: (color: string) => void;
  onWidthChange: (width: number) => void;
  onZoomChange: (zoom: number) => void;
  onResetView: () => void;
  onUndo: () => Promise<void>;
  onRedo: () => Promise<void>;
  onAddPage: () => Promise<unknown>;
  onDeletePage: (pageId: string) => Promise<unknown>;
  onRenamePage: (pageId: string, title: string) => Promise<unknown>;
  onClearPage: (pageId: string) => Promise<unknown>;
  onToggleLock: () => Promise<unknown>;
  onImageFile: (file: File) => Promise<void>;
}

const DRAW_TOOLS: Array<{
  tool: ConferenceWhiteboardTool;
  label: string;
  icon: ReactNode;
}> = [
  { tool: 'pen', label: 'قلم', icon: <Pen className="h-4 w-4" /> },
  { tool: 'marker', label: 'ماژیک', icon: <Pen className="h-4 w-4 stroke-[3]" /> },
  { tool: 'eraser', label: 'پاک‌کن', icon: <Eraser className="h-4 w-4" /> },
  { tool: 'line', label: 'خط', icon: <Minus className="h-4 w-4" /> },
  { tool: 'arrow', label: 'فلش', icon: <ArrowRight className="h-4 w-4" /> },
  { tool: 'rectangle', label: 'مستطیل', icon: <Square className="h-4 w-4" /> },
  { tool: 'circle', label: 'دایره', icon: <Circle className="h-4 w-4" /> },
  { tool: 'text', label: 'متن', icon: <Type className="h-4 w-4" /> },
  { tool: 'sticky', label: 'یادداشت', icon: <StickyNote className="h-4 w-4" /> },
];

export function ConferenceWhiteboardToolbar({
  pages,
  selectedPageId,
  tool,
  color,
  width,
  zoom,
  canUse,
  canEdit,
  canManage,
  locked,
  busy,
  canUndo,
  canRedo,
  onSelectPage,
  onToolChange,
  onColorChange,
  onWidthChange,
  onZoomChange,
  onResetView,
  onUndo,
  onRedo,
  onAddPage,
  onDeletePage,
  onRenamePage,
  onClearPage,
  onToggleLock,
  onImageFile,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const selectedPage = pages.find((page) => page.id === selectedPageId);

  const renamePage = () => {
    if (!selectedPage) return;
    const title = window.prompt('نام صفحه', selectedPage.title)?.trim();
    if (title) void onRenamePage(selectedPage.id, title);
  };

  const deletePage = () => {
    if (!selectedPage || pages.length <= 1) return;
    if (window.confirm(`صفحه «${selectedPage.title}» حذف شود؟`)) {
      void onDeletePage(selectedPage.id);
    }
  };

  const clearPage = () => {
    if (!selectedPage) return;
    if (window.confirm('تمام محتوای این صفحه پاک شود؟')) {
      void onClearPage(selectedPage.id);
    }
  };

  return (
    <div className="space-y-2 border-b border-white/10 bg-slate-950/70 p-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <select
          value={selectedPageId || ''}
          onChange={(event) => onSelectPage(event.target.value)}
          className="h-9 max-w-44 rounded-lg border border-white/10 bg-slate-900 px-2 text-xs text-white"
          aria-label="انتخاب صفحه تخته"
        >
          {pages.map((page) => (
            <option key={page.id} value={page.id}>{page.title}</option>
          ))}
        </select>

        {canManage && (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => void onAddPage()}
              className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-800 disabled:opacity-40"
              aria-label="افزودن صفحه"
            >
              <Plus className="h-4 w-4" />
            </button>
            <button
              type="button"
              disabled={busy || !selectedPage}
              onClick={renamePage}
              className="h-9 rounded-lg bg-slate-800 px-2 text-[10px] disabled:opacity-40"
            >
              تغییر نام
            </button>
            <button
              type="button"
              disabled={busy || pages.length <= 1}
              onClick={deletePage}
              className="flex h-9 w-9 items-center justify-center rounded-lg bg-rose-950/70 text-rose-200 disabled:opacity-40"
              aria-label="حذف صفحه"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </>
        )}

        <div className="mx-1 h-6 w-px bg-white/10" />

        <button
          type="button"
          disabled={busy || !canUndo}
          onClick={() => void onUndo()}
          className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-800 disabled:opacity-30"
          aria-label="Undo"
        >
          <Undo2 className="h-4 w-4" />
        </button>
        <button
          type="button"
          disabled={busy || !canRedo}
          onClick={() => void onRedo()}
          className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-800 disabled:opacity-30"
          aria-label="Redo"
        >
          <Redo2 className="h-4 w-4" />
        </button>

        <div className="mx-1 h-6 w-px bg-white/10" />

        <button
          type="button"
          onClick={() => onToolChange('pan')}
          className={`flex h-9 w-9 items-center justify-center rounded-lg ${
            tool === 'pan' ? 'bg-cyan-600 text-white' : 'bg-slate-800'
          }`}
          aria-label="جابجایی صفحه"
        >
          <Hand className="h-4 w-4" />
        </button>
        {canUse && (
          <button
            type="button"
            onClick={() => onToolChange('laser')}
            className={`flex h-9 w-9 items-center justify-center rounded-lg ${
              tool === 'laser' ? 'bg-rose-600 text-white' : 'bg-slate-800'
            }`}
            aria-label="نشانگر لیزری"
          >
            <Crosshair className="h-4 w-4" />
          </button>
        )}

        {DRAW_TOOLS.map((item) => (
          <button
            key={item.tool}
            type="button"
            disabled={!canEdit || busy}
            onClick={() => onToolChange(item.tool)}
            className={`flex h-9 w-9 items-center justify-center rounded-lg disabled:opacity-30 ${
              tool === item.tool ? 'bg-cyan-600 text-white' : 'bg-slate-800'
            }`}
            aria-label={item.label}
            title={item.label}
          >
            {item.icon}
          </button>
        ))}

        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void onImageFile(file);
          }}
        />
        <button
          type="button"
          disabled={!canEdit || busy || !selectedPage}
          onClick={() => fileRef.current?.click()}
          className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-800 disabled:opacity-30"
          aria-label="افزودن تصویر"
        >
          <ImageIcon className="h-4 w-4" />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="color"
          value={color}
          disabled={!canEdit}
          onChange={(event) => onColorChange(event.target.value)}
          className="h-8 w-10 rounded border-0 bg-transparent p-0 disabled:opacity-40"
          aria-label="رنگ"
        />
        <select
          value={width}
          disabled={!canEdit}
          onChange={(event) => onWidthChange(Number(event.target.value))}
          className="h-8 rounded-lg border border-white/10 bg-slate-900 px-2 text-[10px]"
          aria-label="ضخامت"
        >
          {[2, 4, 6, 10, 16, 24].map((value) => (
            <option key={value} value={value}>{value}px</option>
          ))}
        </select>

        <div className="mx-1 h-6 w-px bg-white/10" />

        <button
          type="button"
          onClick={() => onZoomChange(Math.max(0.25, zoom / 1.2))}
          className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-800"
          aria-label="کاهش بزرگ‌نمایی"
        >
          <ZoomOut className="h-4 w-4" />
        </button>
        <span className="min-w-12 text-center text-[10px] text-slate-300">
          {Math.round(zoom * 100)}٪
        </span>
        <button
          type="button"
          onClick={() => onZoomChange(Math.min(4, zoom * 1.2))}
          className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-800"
          aria-label="افزایش بزرگ‌نمایی"
        >
          <ZoomIn className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onResetView}
          className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-800"
          aria-label="بازنشانی نما"
        >
          <RotateCcw className="h-4 w-4" />
        </button>

        {canManage && (
          <>
            <div className="mx-1 h-6 w-px bg-white/10" />
            <button
              type="button"
              disabled={busy}
              onClick={() => void onToggleLock()}
              className={`flex h-8 items-center gap-1 rounded-lg px-2 text-[10px] disabled:opacity-40 ${
                locked
                  ? 'bg-amber-600 text-slate-950'
                  : 'bg-slate-800 text-slate-200'
              }`}
            >
              {locked ? <Unlock className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
              {locked ? 'باز کردن تخته' : 'قفل تخته'}
            </button>
            <button
              type="button"
              disabled={busy || !selectedPage}
              onClick={clearPage}
              className="flex h-8 items-center gap-1 rounded-lg bg-rose-950/60 px-2 text-[10px] text-rose-200 disabled:opacity-40"
            >
              <Trash2 className="h-3.5 w-3.5" />
              پاک‌کردن صفحه
            </button>
          </>
        )}
      </div>
    </div>
  );
}
