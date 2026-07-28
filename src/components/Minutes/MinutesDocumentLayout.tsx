import type {
  MinutesDocumentData,
} from './MinutesDocumentData';
import {
  DASH, orDash,
  STATUS_LABELS, CONF_LABELS,
  SYSTEM_TITLE, FALLBACK_LOGO, chunkArray,
} from './MinutesDocumentData';
import type { ConfidentialityLevel, MinutesStatus } from './types';
import { gregorianToJalaliDate, toPersianDigits } from '../../lib/minutesDate';

interface MinutesDocumentLayoutProps {
  data: MinutesDocumentData;
  variant: 'print' | 'preview';
}

export function MinutesDocumentLayout({ data, variant }: MinutesDocumentLayoutProps) {
  const { minute, internalParts, externalParts, agendaItems, decisions, logoUrl } = data;

  const status = minute.status as MinutesStatus;
  const conf = minute.confidentiality as ConfidentialityLevel;

  const isConfidential = conf === 'confidential' || conf === 'restricted';
  const isDraft = status === 'draft';
  const isChangesRequested = status === 'changes_requested';
  const showWatermark = isDraft || isChangesRequested;
  const watermarkText = isDraft ? 'پیش‌نویس — فاقد اعتبار نهایی' : 'در حال اصلاح — فاقد اعتبار نهایی';

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

  const logoSrc = logoUrl || FALLBACK_LOGO;

  const rootClass = variant === 'print' ? 'minutes-print-root' : 'minutes-preview-root';

  return (
    <div className={rootClass} dir="rtl">
      <div className="mp-doc">
        {isConfidential && (
          <div className={`mp-conf-banner ${conf === 'confidential' ? 'confidential' : 'restricted'}`}>
            {CONF_LABELS[conf]}
          </div>
        )}

        {showWatermark && <div className="mp-watermark">{watermarkText}</div>}

        {/* Header with logo top-right */}
        <div className="mp-header">
          <div className="mp-header-logo">
            <img src={logoSrc} alt="لوگو سازمان" className="mp-logo" />
          </div>
          <h1>صورت‌جلسه</h1>
          <div className="mp-sub">{minute.meeting_title_snapshot}</div>
          <div className="mp-meta">
            تاریخ جلسه: {toPersianDigits(gregorianToJalaliDate(minute.meeting_date_snapshot) ?? minute.meeting_date_snapshot)} — شماره نسخه: {minute.revision_number}
          </div>
        </div>

        {/* 1. Meeting info */}
        <div className="mp-section mp-no-break">
          <h2 className="mp-section-title">مشخصات جلسه</h2>
          <div className="mp-info-grid">
            <div className="mp-field"><span className="mp-label">عنوان جلسه:</span><span className="mp-value">{minute.meeting_title_snapshot}</span></div>
            <div className="mp-field"><span className="mp-label">تاریخ جلسه:</span><span className="mp-value">{toPersianDigits(gregorianToJalaliDate(minute.meeting_date_snapshot) ?? minute.meeting_date_snapshot)}</span></div>
            <div className="mp-field"><span className="mp-label">ساعت شروع:</span><span className="mp-value">{orDash(minute.meeting_start_time_snapshot)}</span></div>
            <div className="mp-field"><span className="mp-label">ساعت پایان:</span><span className="mp-value">{orDash(minute.meeting_end_time_snapshot)}</span></div>
            <div className="mp-field"><span className="mp-label">محل جلسه:</span><span className="mp-value">{orDash(minute.meeting_location_snapshot)}</span></div>
            <div className="mp-field"><span className="mp-label">نوع جلسه:</span><span className="mp-value">{orDash(minute.meeting_type)}</span></div>
            <div className="mp-field"><span className="mp-label">واحد سازمانی:</span><span className="mp-value">{orDash(minute.org_unit_name_snapshot)}</span></div>
            <div className="mp-field"><span className="mp-label">شماره نسخه:</span><span className="mp-value">{minute.revision_number}</span></div>
            <div className="mp-field"><span className="mp-label">وضعیت:</span><span className="mp-value">{STATUS_LABELS[status] || minute.status}</span></div>
            <div className="mp-field"><span className="mp-label">سطح محرمانگی:</span><span className="mp-value">{CONF_LABELS[conf] || minute.confidentiality}</span></div>
            <div className="mp-field"><span className="mp-label">دبیر جلسه:</span><span className="mp-value">{minute.secretary_name_snapshot}</span></div>
            <div className="mp-field"><span className="mp-label">رئیس جلسه:</span><span className="mp-value">{minute.chair_name_snapshot}</span></div>
          </div>
        </div>

        {/* 2. Agenda items — title-only list */}
        <div className="mp-section">
          <h2 className="mp-section-title">دستور جلسات</h2>
          {agendaItems.length === 0 ? (
            <p className="mp-item-row">{DASH}</p>
          ) : (
            <ol className="mp-agenda-list">
              {agendaItems.map(item => (
                <li key={item.id} className="mp-agenda-list-item">
                  {toPersianDigits(item.order)}. {item.title}
                </li>
              ))}
            </ol>
          )}
        </div>

        {/* 3. Decisions — description, responsible unit, due date only */}
        <div className="mp-section">
          <h2 className="mp-section-title">مصوبات</h2>
          {decisions.length === 0 ? (
            <p className="mp-item-row">{DASH}</p>
          ) : (
            decisions.map((d, i) => (
              <div key={d.id} className="mp-decision-item">
                <div className="mp-item-title">مصوبه {toPersianDigits(i + 1)}</div>
                <div className="mp-item-row"><span className="mp-item-label">متن مصوبه: </span>{orDash(d.description)}</div>
                <div className="mp-item-row"><span className="mp-item-label">واحد مسئول: </span>{orDash(d.responsibleUnitName)}</div>
                <div className="mp-item-row"><span className="mp-item-label">مهلت انجام: </span>{orDash(d.dueDate ? toPersianDigits(gregorianToJalaliDate(d.dueDate) ?? d.dueDate) : '')}</div>
              </div>
            ))
          )}
        </div>

        {/* 4. Participants and signatures — merged */}
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

      {variant === 'print' && (
        <div className="mp-footer">
          {isConfidential && <span className="mp-conf-tag">{CONF_LABELS[conf]} — </span>}
          {SYSTEM_TITLE} — تاریخ چاپ: {new Date().toLocaleDateString('fa-IR')} — صفحه‌بندی توسط مرورگر
        </div>
      )}
    </div>
  );
}
