import type {
  MinutesDocumentData,
} from './MinutesDocumentData';
import {
  DASH, orDash, faDateTime,
  STATUS_LABELS, CONF_LABELS, APPROVAL_MODE_LABELS, APPROVAL_STATUS_LABELS,
  AGENDA_RESULT_LABELS, PRIORITY_LABELS,
  SYSTEM_TITLE, FALLBACK_LOGO, chunkArray,
} from './MinutesDocumentData';
import type { ConfidentialityLevel, MinutesStatus, ApprovalMode } from './types';

interface MinutesDocumentLayoutProps {
  data: MinutesDocumentData;
  variant: 'print' | 'preview';
}

export function MinutesDocumentLayout({ data, variant }: MinutesDocumentLayoutProps) {
  const { minute, internalParts, externalParts, agendaItems, decisions, approvals, approvalComments, logoUrl } = data;

  const status = minute.status as MinutesStatus;
  const conf = minute.confidentiality as ConfidentialityLevel;
  const mode = minute.approval_mode as ApprovalMode | null;

  const isConfidential = conf === 'confidential' || conf === 'restricted';
  const isDraft = status === 'draft';
  const isChangesRequested = status === 'changes_requested';
  const showWatermark = isDraft || isChangesRequested;
  const watermarkText = isDraft ? 'پیش‌نویس — فاقد اعتبار نهایی' : 'در حال اصلاح — فاقد اعتبار نهایی';

  const allSigners = [
    ...internalParts.map(p => ({
      id: p.id,
      name: p.name_snapshot,
      sub: [p.position_snapshot, p.org_unit_name_snapshot].filter(Boolean).join(' — ') || DASH,
    })),
    ...externalParts.map(p => ({
      id: p.id,
      name: p.full_name,
      sub: [p.position, p.organization].filter(Boolean).join(' — ') || DASH,
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
            تاریخ جلسه: {minute.meeting_date_snapshot} — شماره نسخه: {minute.revision_number}
          </div>
        </div>

        {/* 1. Meeting info */}
        <div className="mp-section mp-no-break">
          <h2 className="mp-section-title">مشخصات جلسه</h2>
          <div className="mp-info-grid">
            <div className="mp-field"><span className="mp-label">عنوان جلسه:</span><span className="mp-value">{minute.meeting_title_snapshot}</span></div>
            <div className="mp-field"><span className="mp-label">تاریخ جلسه:</span><span className="mp-value">{minute.meeting_date_snapshot}</span></div>
            <div className="mp-field"><span className="mp-label">ساعت شروع:</span><span className="mp-value">{orDash(minute.meeting_start_time_snapshot)}</span></div>
            <div className="mp-field"><span className="mp-label">ساعت پایان:</span><span className="mp-value">{orDash(minute.meeting_end_time_snapshot)}</span></div>
            <div className="mp-field"><span className="mp-label">محل جلسه:</span><span className="mp-value">{orDash(minute.meeting_location_snapshot)}</span></div>
            <div className="mp-field"><span className="mp-label">نوع جلسه:</span><span className="mp-value">{orDash(minute.meeting_type)}</span></div>
            <div className="mp-field"><span className="mp-label">واحد سازمانی:</span><span className="mp-value">{orDash(minute.org_unit_name_snapshot)}</span></div>
            <div className="mp-field"><span className="mp-label">شماره نسخه:</span><span className="mp-value">{minute.revision_number}</span></div>
            <div className="mp-field"><span className="mp-label">مدل تأیید:</span><span className="mp-value">{mode ? APPROVAL_MODE_LABELS[mode] : DASH}</span></div>
            <div className="mp-field"><span className="mp-label">وضعیت:</span><span className="mp-value">{STATUS_LABELS[status] || minute.status}</span></div>
            <div className="mp-field"><span className="mp-label">سطح محرمانگی:</span><span className="mp-value">{CONF_LABELS[conf] || minute.confidentiality}</span></div>
            <div className="mp-field"><span className="mp-label">دبیر جلسه:</span><span className="mp-value">{minute.secretary_name_snapshot}</span></div>
            <div className="mp-field"><span className="mp-label">رئیس جلسه:</span><span className="mp-value">{minute.chair_name_snapshot}</span></div>
          </div>
        </div>

        {/* 2. Agenda items */}
        <div className="mp-section">
          <h2 className="mp-section-title">دستور جلسات</h2>
          {agendaItems.length === 0 ? (
            <p className="mp-item-row">{DASH}</p>
          ) : (
            agendaItems.map(item => (
              <div key={item.id} className="mp-agenda-item">
                <div className="mp-item-title">{item.order}. {item.title}</div>
                {item.description && (
                  <div className="mp-item-row"><span className="mp-item-label">شرح: </span>{item.description}</div>
                )}
                <div className="mp-item-row"><span className="mp-item-label">ارائه‌دهنده: </span>{orDash(item.presenter)}</div>
                {item.allocatedTime && (
                  <div className="mp-item-row"><span className="mp-item-label">زمان: </span>{item.allocatedTime}</div>
                )}
              </div>
            ))
          )}
        </div>

        {/* 3. Decisions */}
        <div className="mp-section">
          <h2 className="mp-section-title">مصوبات</h2>
          {decisions.length === 0 ? (
            <p className="mp-item-row">{DASH}</p>
          ) : (
            decisions.map((d, i) => (
              <div key={d.id} className="mp-decision-item">
                <div className="mp-item-title">{i + 1}. {d.title}</div>
                {d.description && (
                  <div className="mp-item-row"><span className="mp-item-label">شرح: </span>{d.description}</div>
                )}
                <div className="mp-item-row">
                  <span className="mp-item-label">واحد مسئول: </span>{orDash(d.responsibleUnitName)}
                  <span className="mp-item-sep"> — </span>
                  <span className="mp-item-label">مسئول اصلی: </span>{orDash(d.primaryOwnerName)}
                </div>
                <div className="mp-item-row">
                  <span className="mp-item-label">اولویت: </span>{PRIORITY_LABELS[d.priority] || d.priority}
                  <span className="mp-item-sep"> — </span>
                  <span className="mp-item-label">مهلت: </span>{orDash(d.dueDate)}
                </div>
                <div className="mp-item-row">
                  <span className="mp-item-label">نتیجه بحث: </span>{orDash(d.discussionResult)}
                  <span className="mp-item-sep"> — </span>
                  <span className="mp-item-label">نوع نتیجه: </span>{AGENDA_RESULT_LABELS[d.resultType] || d.resultType}
                </div>
                {d.additionalNotes && (
                  <div className="mp-item-row"><span className="mp-item-label">توضیحات تکمیلی: </span>{d.additionalNotes}</div>
                )}
              </div>
            ))
          )}
        </div>

        {/* 4. Participants (internal + external) */}
        {(internalParts.length > 0 || externalParts.length > 0) && (
          <div className="mp-section">
            <h2 className="mp-section-title">شرکت‌کنندگان</h2>
            {internalParts.length > 0 && (
              <>
                <h3 className="mp-subtitle">شرکت‌کنندگان داخلی</h3>
                <table className="mp-table">
                  <thead>
                    <tr>
                      <th style={{ width: '8mm' }}>ردیف</th>
                      <th>نام</th>
                      <th>سمت</th>
                      <th>واحد</th>
                    </tr>
                  </thead>
                  <tbody>
                    {internalParts.map((p, i) => (
                      <tr key={p.id}>
                        <td>{i + 1}</td>
                        <td>{p.name_snapshot}</td>
                        <td>{orDash(p.position_snapshot)}</td>
                        <td>{orDash(p.org_unit_name_snapshot)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
            {externalParts.length > 0 && (
              <>
                <h3 className="mp-subtitle">شرکت‌کنندگان خارجی</h3>
                <table className="mp-table">
                  <thead>
                    <tr>
                      <th style={{ width: '8mm' }}>ردیف</th>
                      <th>نام</th>
                      <th>سازمان</th>
                      <th>سمت</th>
                    </tr>
                  </thead>
                  <tbody>
                    {externalParts.map((p, i) => (
                      <tr key={p.id}>
                        <td>{i + 1}</td>
                        <td>{p.full_name}</td>
                        <td>{orDash(p.organization)}</td>
                        <td>{orDash(p.position)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>
        )}

        {/* 5. Signature area */}
        {allSigners.length > 0 && (
          <div className="mp-section mp-no-break">
            <h2 className="mp-section-title">محل امضاها</h2>
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

        {/* Change requests */}
        {approvalComments.length > 0 && (
          <div className="mp-section">
            <h2 className="mp-section-title">درخواست‌های اصلاح</h2>
            <table className="mp-table">
              <thead>
                <tr>
                  <th>نام درخواست‌کننده</th>
                  <th>علت</th>
                  <th>پیشنهاد اصلاح</th>
                  <th>نسخه</th>
                </tr>
              </thead>
              <tbody>
                {approvalComments.map(c => (
                  <tr key={c.id}>
                    <td>{c.created_by_name}</td>
                    <td>{c.reason}</td>
                    <td>{orDash(c.suggested_correction)}</td>
                    <td>{minute.revision_number}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Approvals */}
        <div className="mp-section mp-no-break">
          <h2 className="mp-section-title">تأییدها</h2>
          {mode === 'system' && approvals.length > 0 && (
            <table className="mp-table mp-approvals-table">
              <thead>
                <tr>
                  <th>نام تأییدکننده</th>
                  <th>وضعیت تأیید</th>
                  <th>زمان تأیید</th>
                </tr>
              </thead>
              <tbody>
                {approvals.map(a => (
                  <tr key={a.id}>
                    <td>{a.approver_name}</td>
                    <td>{APPROVAL_STATUS_LABELS[a.status] || a.status}</td>
                    <td>{faDateTime(a.approved_at || a.changes_requested_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {mode === 'in_person' && (
            <p className="mp-item-row">این صورت‌جلسه به‌صورت حضوری تأیید شده است.</p>
          )}

          <div className="mp-sign-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <div className="mp-sign-box">
              <div className="mp-sign-name">تأیید دبیر: {minute.secretary_name_snapshot}</div>
              <div>زمان تأیید دبیر: {faDateTime(minute.secretary_confirmed_at)}</div>
            </div>
            <div className="mp-sign-box">
              <div className="mp-sign-name">تأیید رئیس: {minute.chair_name_snapshot}</div>
              <div>زمان تأیید رئیس: {faDateTime(minute.chair_confirmed_at)}</div>
            </div>
          </div>
          <div className="mp-item-row" style={{ marginTop: '3mm' }}>
            <span className="mp-item-label">زمان انتشار: </span>{faDateTime(minute.published_at)}
          </div>
        </div>

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
