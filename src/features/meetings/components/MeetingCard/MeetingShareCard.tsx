import { forwardRef } from 'react';
import { Meeting } from '../../../../types';
import type { AgendaItem } from '../../../../types';

interface MeetingShareCardProps {
  meeting: Meeting;
  agendaItems: AgendaItem[];
}

export const MeetingShareCard = forwardRef<HTMLDivElement, MeetingShareCardProps>(
  ({ meeting, agendaItems }, ref) => {
    return (
      <div style={{ position: 'fixed', top: '-9999px', left: '-9999px', zIndex: -1 }}>
        <div ref={ref} style={{ width: 360, backgroundColor: '#fff', fontFamily: 'Vazirmatn, system-ui, sans-serif', direction: 'rtl', borderRadius: 16, overflow: 'hidden', boxShadow: '0 4px 24px rgba(0,0,0,0.12)' }}>
          <div style={{ background: 'linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%)', padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
              </svg>
            </div>
            <div style={{ flex: 1 }}>
              <p style={{ color: '#fff', fontWeight: 700, fontSize: 15, margin: 0, lineHeight: 1.4 }}>{meeting.subject}</p>
              <p style={{ color: 'rgba(255,255,255,0.8)', fontSize: 11, margin: '2px 0 0', letterSpacing: 0.5 }}>Spark Meeting Manager</p>
            </div>
          </div>
          <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[
              { label: 'تاریخ', value: new Date(meeting.requestDate).toLocaleDateString('fa-IR') },
              { label: 'زمان', value: meeting.start_time && meeting.end_time ? `${meeting.start_time} — ${meeting.end_time}` : meeting.duration },
              { label: 'محل برگزاری', value: meeting.location },
              { label: 'نماینده', value: meeting.representative },
              { label: 'تلفن تماس', value: meeting.phone },
              { label: 'یادداشت', value: meeting.notes },
              { label: 'دستور جلسه', value: agendaItems.length > 0
                  ? agendaItems.map((item, idx) => {
                      const parts = [`${idx + 1}. ${item.title}`];
                      if (item.presenter) parts.push(`ارائه‌دهنده: ${item.presenter}`);
                      if (item.duration_minutes) parts.push(`${item.duration_minutes} دقیقه`);
                      return parts.join(' | ');
                    }).join('\n')
                  : '' },
            ].filter(r => r.value).map(r => (
              <div key={r.label} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <span style={{ color: '#6b7280', fontSize: 12, minWidth: 90, flexShrink: 0 }}>{r.label}:</span>
                <span style={{ color: '#111827', fontSize: 12, wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>{r.value}</span>
              </div>
            ))}
          </div>
          <div style={{ padding: '10px 20px', backgroundColor: '#f0f9ff', borderTop: '1px solid #e0f2fe', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#0ea5e9" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
            </svg>
            <p style={{ color: '#0ea5e9', fontSize: 11, margin: 0 }}>سیستم مدیریت جلسات اسپارک</p>
          </div>
        </div>
      </div>
    );
  }
);

MeetingShareCard.displayName = 'MeetingShareCard';
