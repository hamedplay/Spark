import type { ReactNode } from 'react';
import '../minutes-print.css';

const A4_WIDTH_PX = 794;

interface MinutesPreviewFrameProps {
  children: ReactNode;
  fontSize?: string;
}

export function MinutesPreviewFrame({ children, fontSize = '14px' }: MinutesPreviewFrameProps) {
  return (
    <div className="p-5 overflow-x-auto">
      <div
        className="mx-auto bg-white border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm minutes-preview-root"
        style={{ maxWidth: `${A4_WIDTH_PX}px`, width: '100%', fontSize }}
      >
        {children}
      </div>
    </div>
  );
}
