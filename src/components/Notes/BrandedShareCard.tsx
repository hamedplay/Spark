import type { RefObject } from 'react';
import type { Note } from './types';

export function BrandedShareCard({
  shareNote,
  brandedCardRef,
}: {
  shareNote: Note;
  brandedCardRef: RefObject<HTMLDivElement | null>;
}) {
  return (
    <div style={{ position: 'fixed', top: '-9999px', left: '-9999px', zIndex: -1 }}>
      <div
        ref={brandedCardRef}
        style={{
          width: '360px',
          backgroundColor: '#fff',
          fontFamily: 'Vazirmatn, system-ui, sans-serif',
          direction: 'rtl',
          borderRadius: '16px',
          overflow: 'hidden',
          boxShadow: '0 4px 24px rgba(0,0,0,0.12)',
        }}
      >
        {/* Header */}
        <div style={{ backgroundColor: '#3b82f6', padding: '16px 20px' }}>
          <p style={{ color: '#fff', fontWeight: 700, fontSize: 16, margin: 0 }}>{shareNote.title}</p>
          <p style={{ color: 'rgba(255,255,255,0.85)', fontSize: 12, margin: '4px 0 0' }}>
            {new Date(shareNote.created_at).toLocaleDateString('fa-IR')}
          </p>
        </div>
        {/* Body */}
        <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {shareNote.content && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <span style={{ color: '#6b7280', fontSize: 12, minWidth: 64, flexShrink: 0 }}>محتوا:</span>
              <span style={{ color: '#111827', fontSize: 12, wordBreak: 'break-word', whiteSpace: 'pre-wrap', lineHeight: '1.7' }}>{shareNote.content}</span>
            </div>
          )}
        </div>
        {/* Footer */}
        <div style={{ padding: '10px 20px', backgroundColor: '#f9fafb', borderTop: '1px solid #e5e7eb' }}>
          <p style={{ color: '#9ca3af', fontSize: 11, margin: 0, textAlign: 'center' }}>سیستم مدیریت جلسات</p>
        </div>
      </div>
    </div>
  );
}
