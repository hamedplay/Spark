import { useState } from 'react';
import type {
  MinutesDocumentData,
} from './MinutesDocumentData';
import {
  DASH, orDash,
  chunkArray,
} from './MinutesDocumentData';
import { gregorianToJalaliDate, toPersianDigits } from '../../lib/minutesDate';

interface MinutesDocumentLayoutProps {
  data: MinutesDocumentData;
  variant: 'print' | 'preview';
}

const PRESENT_STATUSES = new Set(['present', 'online', 'late']);

function jalaliDateDisplay(value: string | null | undefined): string {
  if (!value) return DASH;
  const j = gregorianToJalaliDate(value);
  return j ? toPersianDigits(j) : toPersianDigits(value);
}

export function MinutesDocumentLayout({ data, variant }: MinutesDocumentLayoutProps) {
  const { minute, internalParts, externalParts, agendaItems, decisions, logoUrl } = data;
  const [logoError, setLogoError] = useState(false);

  // ── Attendance lists ───────────────────────────────────────────────────────
  const presentNames: string[] = [];
  const absentNames: string[] = [];

  for (const p of internalParts) {
    const status = p.attendance_status;
    if (status && PRESENT_STATUSES.has(status)) {
      // For delegate_attended use delegate_name when available
      const name = p.delegate_name || p.name_snapshot;
      presentNames.push(name);
    } else if (status === 'absent') {
      absentNames.push(p.name_snapshot);
    }
    // invited/pending/null — not assigned to either list without explicit product decision
  }
  for (const p of externalParts) {
    const status = p.attendance_status;
    if (status && PRESENT_STATUSES.has(status)) {
      presentNames.push(p.full_name);
    } else if (status === 'absent') {
      absentNames.push(p.full_name);
    }
  }

  // ── Signatories (all participants) ─────────────────────────────────────────
  const allSigners = [
    ...internalParts.map(p => ({
      id: p.id,
      name: p.name_snapshot,
      sub: p.org_unit_name_snapshot || DASH,
    })),
    ...externalParts.map(p => ({
      id: p.id,
      name: p.full_name,
      sub: p.organization || DASH,
    })),
  ];
  const signCols = allSigners.length <= 1 ? 1 : Math.min(allSigners.length, 6);
  const signRows = chunkArray(allSigners, signCols);

  const rootClass = variant === 'print' ? 'minutes-print-root' : 'minutes-preview-root';

  return (
    <div className={rootClass} dir="rtl">
      {variant === 'preview' && (
        <div className="mp-print-hint">
          برای خروجی بدون آدرس صفحه، گزینه Headers and footers مرورگر را غیرفعال کنید.
        </div>
      )}

      <div className="mp-doc">
        {/* ── Header ────────────────────────────────────────────────────────── */}
        <div className="mp-header">
          <div className="mp-header-logo">
            {logoUrl && !logoError ? (
              <img
                src={logoUrl}
                alt="لوگو سازمان"
                className="mp-logo"
                onError={() => setLogoError(true)}
              />
            ) : (
              <div className="mp-logo-placeholder">محل لوگو</div>
            )}
          </div>
          <h1>صورت‌جلسه</h1>
        </div>

        {/* ── Meeting details ────────────────────────────────────────────────── */}
        <div className="mp-section mp-no-break">
          <h2 className="mp-section-title">مشخصات جلسه</h2>
          {/* Row 1: Meeting title full width */}
          <div className="mp-info-row-full">
            <span className="mp-label">عنوان جلسه:</span>
            <span className="mp-value">{orDash(minute.meeting_title_snapshot)}</span>
          </div>
          {/* Row 2: Attendees / Absentees */}
          <div className="mp-info-row-two">
            <div className="mp-field">
              <span className="mp-label">حاضرین جلسه:</span>
              <span className="mp-value">{presentNames.length > 0 ? presentNames.join('، ') : DASH}</span>
            </div>
            <div className="mp-field">
              <span className="mp-label">غایبین جلسه:</span>
              <span className="mp-value">{absentNames.length > 0 ? absentNames.join('، ') : DASH}</span>
            </div>
          </div>
          {/* Row 3: Location / Secretary / Chair */}
          <div className="mp-info-row-three">
            <div className="mp-field">
              <span className="mp-label">محل جلسه:</span>
              <span className="mp-value">{orDash(minute.meeting_location_snapshot)}</span>
            </div>
            <div className="mp-field">
              <span className="mp-label">دبیر جلسه:</span>
              <span className="mp-value">{orDash(minute.secretary_name_snapshot)}</span>
            </div>
            <div className="mp-field">
              <span className="mp-label">رئیس جلسه:</span>
              <span className="mp-value">{orDash(minute.chair_name_snapshot)}</span>
            </div>
          </div>
        </div>

        {/* ── Agenda items ───────────────────────────────────────────────────── */}
        <div className="mp-section">
          <h2 className="mp-section-title">دستور جلسات</h2>
          {agendaItems.length === 0 ? (
            <p className="mp-item-row">{DASH}</p>
          ) : (
            <ol className="mp-agenda-list">
              {agendaItems.map(item => (
                <li key={item.id} className="mp-agenda-list-item">
                  {toPersianDigits(String(item.order))}. {item.title}
                </li>
              ))}
            </ol>
          )}
        </div>

        {/* ── Decisions ─────────────────────────────────────────────────────── */}
        <div className="mp-section">
          <h2 className="mp-section-title">مصوبات</h2>
          {decisions.length === 0 ? (
            <p className="mp-item-row">{DASH}</p>
          ) : (
            decisions.map((d, i) => {
              const fullText = [d.title, d.description].filter(Boolean).join(' — ') || DASH;
              return (
                <div key={d.id} className="mp-decision-item">
                  <div className="mp-item-title">
                    مصوبه {toPersianDigits(String(i + 1))} — {fullText}
                  </div>
                  <div className="mp-item-row"><span className="mp-item-label">واحد مسئول: </span>{orDash(d.responsibleUnitName)}</div>
                  <div className="mp-item-row">
                    <span className="mp-item-label">مهلت انجام: </span>
                    {d.dueDate ? jalaliDateDisplay(d.dueDate) : DASH}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* ── Signatures ────────────────────────────────────────────────────── */}
        {allSigners.length > 0 && (
          <div className="mp-section">
            <h2 className="mp-section-title">شرکت‌کنندگان و امضاها</h2>
            {signRows.map((row, rowIdx) => (
              <div key={rowIdx} className="mp-sign-grid" style={{ gridTemplateColumns: `repeat(${signCols}, 1fr)` }}>
                {row.map(s => (
                  <div key={s.id} className="mp-sign-box">
                    <div className="mp-sign-name">{s.name}</div>
                    <div className="mp-sign-sub">{s.sub}</div>
                    <div className="mp-sign-space" />
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {minute.notes && (
          <div className="mp-section mp-no-break">
            <h2 className="mp-section-title">یادداشت</h2>
            <p className="mp-item-row" style={{ whiteSpace: 'pre-wrap' }}>{minute.notes}</p>
          </div>
        )}

        <div className="mp-end-note">پایان صورت‌جلسه</div>
      </div>
    </div>
  );
}
