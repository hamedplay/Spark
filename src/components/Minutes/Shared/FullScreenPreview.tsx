import { useState, useEffect, useCallback } from 'react';
import { ZoomIn, ZoomOut, X, Printer, FileDown } from 'lucide-react';
import { MinutesDocumentLayout } from '../MinutesDocumentLayout';
import type { MinutesDocumentData } from '../MinutesDocumentData';

const MIN_ZOOM = 50;
const MAX_ZOOM = 200;
const ZOOM_STEP = 10;

interface FullScreenPreviewProps {
  open: boolean;
  onClose: () => void;
  docData: MinutesDocumentData;
  onPrint?: () => void;
  onWordExport?: () => void;
  wordLoading?: boolean;
}

export function FullScreenPreview({ open, onClose, docData, onPrint, onWordExport, wordLoading }: FullScreenPreviewProps) {
  const [zoom, setZoom] = useState(100);

  const zoomIn = useCallback(() => setZoom(z => Math.min(MAX_ZOOM, z + ZOOM_STEP)), []);
  const zoomOut = useCallback(() => setZoom(z => Math.max(MIN_ZOOM, z - ZOOM_STEP)), []);
  const zoomReset = useCallback(() => setZoom(100), []);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handler);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  useEffect(() => {
    if (open) setZoom(100);
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/80 flex flex-col"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="flex items-center justify-between px-4 py-3 bg-gray-900 text-white shrink-0">
        <div className="flex items-center gap-2">
          <button
            onClick={zoomOut}
            disabled={zoom <= MIN_ZOOM}
            className="p-2 rounded-lg hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            aria-label="کوچک‌نمایی"
          >
            <ZoomOut className="w-5 h-5" />
          </button>
          <button
            onClick={zoomReset}
            className="px-3 py-1.5 text-sm font-medium rounded-lg hover:bg-gray-700 transition-colors min-w-[70px] text-center"
          >
            {zoom}%
          </button>
          <button
            onClick={zoomIn}
            disabled={zoom >= MAX_ZOOM}
            className="p-2 rounded-lg hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            aria-label="بزرگ‌نمایی"
          >
            <ZoomIn className="w-5 h-5" />
          </button>
          {onPrint && (
            <button
              onClick={onPrint}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg hover:bg-gray-700 transition-colors mr-2"
            >
              <Printer className="w-4 h-4" />
              چاپ
            </button>
          )}
          {onWordExport && (
            <button
              onClick={onWordExport}
              disabled={wordLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg hover:bg-gray-700 transition-colors mr-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {wordLoading ? 'در حال ساخت...' : 'خروجی Word'}
            </button>
          )}
        </div>
        <h3 className="text-sm font-medium hidden sm:block">پیش‌نمایش صورت‌جلسه</h3>
        <button
          onClick={onClose}
          className="p-2 rounded-lg hover:bg-gray-700 transition-colors"
          aria-label="بستن پیش‌نمایش"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div
        className="flex-1 overflow-auto flex justify-center p-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="minutes-fullscreen-doc-wrapper"
          style={{ transform: `scale(${zoom / 100})`, transformOrigin: 'top center' }}
        >
          <MinutesDocumentLayout data={docData} variant="preview" />
        </div>
      </div>
    </div>
  );
}
