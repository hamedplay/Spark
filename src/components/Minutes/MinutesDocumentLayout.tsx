import { useState } from 'react';
import type {
  MinutesDocumentData, DocApproval,
} from './MinutesDocumentData';
import {
  DASH, orDash,
  chunkArray,
  APPROVAL_STATUS_LABELS, faDateTime,
} from './MinutesDocumentData';
import { gregorianToJalaliDate, toPersianDigits } from '../../lib/minutesDate';

const FONT_SIZE_PX: Record<string, string> = {
  small: '12px',
  medium: '14px',
  large: '16px',
};

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
  const { minute, internalParts, externalParts, agendaItems, decisions, logoUrl, config } = data;
  const [logoError, setLogoError] = useState(false);

  const cfg = config;
  const headerTitle = cfg?.headerTitle ?? 'صورت‌جلسه';
  const orgName = cfg?.orgName ?? '';
  const subtitle = cfg?.subtitle ?? '';
  const footerText = cfg?.footerText ?? 'پایان صورت‌جلسه';
  const showLogo = cfg?.showLogo ?? true;
  const showParticipants = cfg?.showParticipants ?? true;
  const showConfidentiality = cfg?.showConfidentiality ?? true;
  const showDecisions = cfg?.showDecisions ?? true;
  const showApprovers = cfg?.showApprovers ?? true;
  const fontSize = cfg?.fontSize ?? 'medium';
  const approvals: DocApproval[] = data.approvals || [];

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
    <div className={rootClass} dir="rtl" style={{ fontSize: FONT_SIZE_PX[fontSize] || '14px' }}>
      {variant === 'preview' && (
        <div className="mp-print-hint">
          برای خروجی بدون آدرس صفحه، گزینه Headers and footers مرورگر را غیرفعال کنید.
        </div>
      )}

      <div className="mp-doc">
        {/* ── Header ────────────────────────────────────────────────────────── */}
        <div className="mp-header">
          {showLogo && (
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
          )}
          <h1>{headerTitle}</h1>
          {orgName && <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{orgName}</p>}
          {subtitle && <p className="text-xs text-gray-500 dark:text-gray-500 mt-0.5">{subtitle}</p>}
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
          {showConfidentiality && (
            <div className="mp-info-row-full">
              <span className="mp-label">سطح محرمانگی:</span>
              <span className="mp-value">{orDash(minute.confidentiality)}</span>
            </div>
          )}
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
        {showDecisions && (
        <div className="mp-section">
          <h2 className="mp-section-title">مصوبات</h2>
          {decisions.length === 0 ? (
            <p className="mp-item-row">{DASH}</p>
          ) : (
            decisions.map((d, i) => {
              const mainText = d.description || d.title || DASH;
              return (
                <div key={d.id} className="mp-decision-item">
                  <div className="mp-item-title">
                    مصوبه {toPersianDigits(String(i + 1))} ـ {mainText}
                  </div>
                  <div className="mp-item-row mp-item-row-inline">
                    <span><span className="mp-item-label">واحد مسئول: </span>{orDash(d.responsibleUnitName)}</span>
                    <span><span className="mp-item-label">مهلت انجام: </span>{d.dueDate ? jalaliDateDisplay(d.dueDate) : DASH}</span>
                  </div>
                </div>
              );
            })
          )}
        </div>
        )}

        {/* ── Signatures ────────────────────────────────────────────────────── */}
        {showParticipants && allSigners.length > 0 && (
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

        {showApprovers && approvals.length > 0 && (
          <div className="mp-section mp-no-break">
            <h2 className="mp-section-title">تأییدکنندگان</h2>
            <div className="mp-info-row-full">
              {approvals.map(a => (
                <div key={a.id} className="mp-field" style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                  <span><span className="mp-label">نام: </span>{orDash(a.approver_name)}</span>
                  <span><span className="mp-label">وضعیت: </span>{APPROVAL_STATUS_LABELS[a.status] || DASH}</span>
                  <span><span className="mp-label">تاریخ: </span>{a.approved_at ? faDateTime(a.approved_at) : a.changes_requested_at ? faDateTime(a.changes_requested_at) : DASH}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {minute.notes && (
          <div className="mp-section mp-no-break">
            <h2 className="mp-section-title">یادداشت</h2>
            <p className="mp-item-row" style={{ whiteSpace: 'pre-wrap' }}>{minute.notes}</p>
          </div>
        )}

        <div className="mp-end-note">{footerText}</div>
      </div>
    </div>
  );
}
