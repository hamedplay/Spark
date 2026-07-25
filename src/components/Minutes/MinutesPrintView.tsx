import { createPortal } from 'react-dom';
import type {
  MinutesStatus, ConfidentialityLevel, ApprovalMode, ApprovalStatus,
  DecisionPriority, DecisionStatus, DecisionRow,
} from './types';

// ── Print-only row types (mirror Detail page local types) ──
export interface PrintMinute {
  id: string;
  meeting_title_snapshot: string;
  meeting_date_snapshot: string;
  meeting_start_time_snapshot: string | null;
  meeting_end_time_snapshot: string | null;
  meeting_location_snapshot: string | null;
  meeting_type: string | null;
  org_unit_name_snapshot: string | null;
  secretary_name_snapshot: string;
  chair_name_snapshot: string;
  notes: string | null;
  confidentiality: string;
  status: string;
  approval_mode: string | null;
  revision_number: number;
  secretary_confirmed_at: string | null;
  chair_confirmed_at: string | null;
  published_at: string | null;
}

export interface PrintInternalPart {
  id: string;
  name_snapshot: string;
  position_snapshot: string | null;
  org_unit_name_snapshot: string | null;
  attendance_status: string | null;
}

export interface PrintExternalPart {
  id: string;
  full_name: string;
  organization: string | null;
  position: string | null;
  attendance_status: string | null;
}

export interface PrintAgendaResult {
  id: string;
  sort_order_snapshot: number;
  agenda_title_snapshot: string;
  agenda_description_snapshot: string | null;
  presenter_snapshot: string | null;
  allocated_minutes_snapshot: number | null;
  discussion_result: string | null;
  result_type: string;
  additional_notes: string | null;
}

export interface PrintApproval {
  id: string;
  approver_name: string;
  status: ApprovalStatus;
  approved_at: string | null;
  changes_requested_at: string | null;
}

export interface PrintApprovalComment {
  id: string;
  agenda_result_id: string | null;
  reason: string;
  suggested_correction: string | null;
  created_by_name: string;
  created_at: string;
}

export interface MinutesPrintViewProps {
  minute: PrintMinute;
  internalParts: PrintInternalPart[];
  externalParts: PrintExternalPart[];
  agendaResults: PrintAgendaResult[];
  approvals: PrintApproval[];
  approvalComments: PrintApprovalComment[];
  decisions: DecisionRow[];
  ownerNames: Record<string, string>;
}

const DASH = '—';

function orDash(v: string | null | undefined): string {
  if (v === null || v === undefined || v === '') return DASH;
  return v;
}

function faDate(iso: string | null): string {
  if (!iso) return DASH;
  try {
    return new Date(iso).toLocaleDateString('fa-IR');
  } catch {
    return iso;
  }
}

function faDateTime(iso: string | null): string {
  if (!iso) return DASH;
  try {
    return new Date(iso).toLocaleString('fa-IR');
  } catch {
    return iso;
  }
}

const STATUS_LABELS: Record<MinutesStatus, string> = {
  draft: 'پیش‌نویس',
  pending_approval: 'در انتظار تأیید',
  changes_requested: 'درخواست اصلاح',
  approved: 'تأییدشده',
  published: 'منتشرشده',
};

const CONF_LABELS: Record<ConfidentialityLevel, string> = {
  public: 'عمومی',
  organizational: 'سازمانی',
  restricted: 'دسترسی محدود',
  confidential: 'محرمانه',
};

const APPROVAL_MODE_LABELS: Record<ApprovalMode, string> = {
  system: 'سیستمی',
  in_person: 'حضوری',
};

const APPROVAL_STATUS_LABELS: Record<ApprovalStatus, string> = {
  pending: 'در انتظار',
  approved: 'تأییدشده',
  changes_requested: 'درخواست اصلاح',
  invalidated: 'باطل‌شده',
};

const AGENDA_RESULT_LABELS: Record<string, string> = {
  discussion: 'بحث و بررسی',
  action: 'اقدام اجرایی',
  resolution: 'مصوبه',
  deferred: 'موکول‌شده',
  no_result: 'بدون نتیجه',
};

const PRIORITY_LABELS: Record<DecisionPriority, string> = {
  low: 'کم',
  normal: 'عادی',
  important: 'مهم',
  urgent: 'فوری',
};

const DECISION_STATUS_LABELS: Record<DecisionStatus, string> = {
  not_started: 'شروع‌نشده',
  planned: 'برنامه‌ریزی‌شده',
  in_progress: 'در حال انجام',
  waiting_coordination: 'منتظر هماهنگی',
  waiting_approval: 'منتظر تأیید',
  completed: 'تکمیل‌شده',
  stopped: 'متوقف‌شده',
};

const ATTEND_LABELS: Record<string, string> = {
  present: 'حاضر',
  absent: 'غایب',
  online: 'آنلاین',
  late: 'با تأخیر',
  delegate_attended: 'حضور جانشین',
};

const SYSTEM_TITLE = 'سامانه مدیریت جلسات';

export function MinutesPrintView(props: MinutesPrintViewProps) {
  const { minute, internalParts, externalParts, agendaResults, approvals, approvalComments, decisions, ownerNames } = props;

  const status = minute.status as MinutesStatus;
  const conf = minute.confidentiality as ConfidentialityLevel;
  const mode = minute.approval_mode as ApprovalMode | null;

  const isConfidential = conf === 'confidential' || conf === 'restricted';
  const isDraft = status === 'draft';
  const isChangesRequested = status === 'changes_requested';
  const showWatermark = isDraft || isChangesRequested;
  const watermarkText = isDraft ? 'پیش‌نویس — فاقد اعتبار نهایی' : 'در حال اصلاح — فاقد اعتبار نهایی';

  const printDate = new Date().toLocaleDateString('fa-IR');

  return createPortal(
    <div className="minutes-print-root" dir="rtl">
      <div className="mp-doc">
        {isConfidential && (
          <div className={`mp-conf-banner ${conf === 'confidential' ? 'confidential' : 'restricted'}`}>
            {CONF_LABELS[conf]}
          </div>
        )}

        {showWatermark && <div className="mp-watermark">{watermarkText}</div>}

        {/* Header — first page only */}
        <div className="mp-header">
          <h1>صورت‌جلسه</h1>
          <div className="mp-sub">{minute.meeting_title_snapshot}</div>
          <div className="mp-meta">
            تاریخ جلسه: {minute.meeting_date_snapshot} — شماره نسخه: {minute.revision_number}
          </div>
        </div>

        {/* Meeting info grid */}
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
          </div>
        </div>

        {/* Officers */}
        <div className="mp-section mp-no-break">
          <h2 className="mp-section-title">مسئولان جلسه</h2>
          <div className="mp-info-grid">
            <div className="mp-field"><span className="mp-label">دبیر جلسه:</span><span className="mp-value">{minute.secretary_name_snapshot}</span></div>
            <div className="mp-field"><span className="mp-label">رئیس جلسه:</span><span className="mp-value">{minute.chair_name_snapshot}</span></div>
          </div>
        </div>

        {/* Internal participants */}
        {internalParts.length > 0 && (
          <div className="mp-section">
            <h2 className="mp-section-title">شرکت‌کنندگان داخلی</h2>
            <table className="mp-table">
              <thead>
                <tr>
                  <th style={{ width: '8mm' }}>ردیف</th>
                  <th>نام</th>
                  <th>سمت</th>
                  <th>واحد</th>
                  <th>وضعیت حضور</th>
                </tr>
              </thead>
              <tbody>
                {internalParts.map((p, i) => (
                  <tr key={p.id}>
                    <td>{i + 1}</td>
                    <td>{p.name_snapshot}</td>
                    <td>{orDash(p.position_snapshot)}</td>
                    <td>{orDash(p.org_unit_name_snapshot)}</td>
                    <td>{p.attendance_status ? (ATTEND_LABELS[p.attendance_status] || p.attendance_status) : DASH}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* External participants */}
        {externalParts.length > 0 && (
          <div className="mp-section">
            <h2 className="mp-section-title">شرکت‌کنندگان خارجی</h2>
            <table className="mp-table">
              <thead>
                <tr>
                  <th style={{ width: '8mm' }}>ردیف</th>
                  <th>نام</th>
                  <th>سازمان</th>
                  <th>سمت</th>
                  <th>وضعیت حضور</th>
                </tr>
              </thead>
              <tbody>
                {externalParts.map((p, i) => (
                  <tr key={p.id}>
                    <td>{i + 1}</td>
                    <td>{p.full_name}</td>
                    <td>{orDash(p.organization)}</td>
                    <td>{orDash(p.position)}</td>
                    <td>{p.attendance_status ? (ATTEND_LABELS[p.attendance_status] || p.attendance_status) : DASH}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Agenda & results */}
        <div className="mp-section">
          <h2 className="mp-section-title">دستور جلسه و نتایج</h2>
          {agendaResults.length === 0 ? (
            <p className="mp-item-row">{DASH}</p>
          ) : (
            agendaResults.map(item => (
              <div key={item.id} className="mp-agenda-item">
                <div className="mp-item-title">{item.sort_order_snapshot}. {item.agenda_title_snapshot}</div>
                {item.agenda_description_snapshot && (
                  <div className="mp-item-row"><span className="mp-item-label">شرح: </span>{item.agenda_description_snapshot}</div>
                )}
                <div className="mp-item-row"><span className="mp-item-label">ارائه‌دهنده: </span>{orDash(item.presenter_snapshot)}</div>
                <div className="mp-item-row"><span className="mp-item-label">زمان تخصیص‌یافته: </span>{item.allocated_minutes_snapshot != null ? `${item.allocated_minutes_snapshot} دقیقه` : DASH}</div>
                <div className="mp-item-row"><span className="mp-item-label">نتیجه بحث: </span>{orDash(item.discussion_result)}</div>
                <div className="mp-item-row"><span className="mp-item-label">نوع نتیجه: </span>{AGENDA_RESULT_LABELS[item.result_type] || item.result_type}</div>
                {item.additional_notes && (
                  <div className="mp-item-row"><span className="mp-item-label">توضیحات تکمیلی: </span>{item.additional_notes}</div>
                )}
              </div>
            ))
          )}
        </div>

        {/* Decisions */}
        <div className="mp-section">
          <h2 className="mp-section-title">مصوبات</h2>
          {decisions.length === 0 ? (
            <p className="mp-item-row">{DASH}</p>
          ) : (
            <table className="mp-table">
              <thead>
                <tr>
                  <th style={{ width: '8mm' }}>ردیف</th>
                  <th>عنوان</th>
                  <th>شرح</th>
                  <th>بند مرتبط</th>
                  <th>مسئول اصلی</th>
                  <th>واحد مسئول</th>
                  <th>اولویت</th>
                  <th>تاریخ شروع</th>
                  <th>مهلت</th>
                  <th>وضعیت</th>
                  <th>درصد پیشرفت</th>
                  <th>آخرین گزارش</th>
                </tr>
              </thead>
              <tbody>
                {decisions.map((d, i) => {
                  const agenda = d.agenda_result_id ? agendaResults.find(a => a.id === d.agenda_result_id) : null;
                  return (
                    <tr key={d.id}>
                      <td>{i + 1}</td>
                      <td>{d.title}</td>
                      <td>{orDash(d.description)}</td>
                      <td>{agenda ? agenda.agenda_title_snapshot : DASH}</td>
                      <td>{ownerNames[d.primary_owner_user_id] || DASH}</td>
                      <td>{orDash(d.responsible_unit_name_snapshot)}</td>
                      <td>{PRIORITY_LABELS[d.priority] || d.priority}</td>
                      <td>{orDash(d.start_date)}</td>
                      <td>{orDash(d.due_date)}</td>
                      <td>{DECISION_STATUS_LABELS[d.status] || d.status}</td>
                      <td>{d.progress_percent}٪</td>
                      <td>{orDash(d.latest_update)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Change requests */}
        {approvalComments.length > 0 && (
          <div className="mp-section">
            <h2 className="mp-section-title">درخواست‌های اصلاح</h2>
            <table className="mp-table">
              <thead>
                <tr>
                  <th>نام درخواست‌کننده</th>
                  <th>بند مورد اعتراض</th>
                  <th>علت</th>
                  <th>پیشنهاد اصلاح</th>
                  <th>نسخه</th>
                </tr>
              </thead>
              <tbody>
                {approvalComments.map(c => {
                  const agenda = c.agenda_result_id ? agendaResults.find(a => a.id === c.agenda_result_id) : null;
                  return (
                    <tr key={c.id}>
                      <td>{c.created_by_name}</td>
                      <td>{agenda ? agenda.agenda_title_snapshot : 'اعتراض کلی'}</td>
                      <td>{c.reason}</td>
                      <td>{orDash(c.suggested_correction)}</td>
                      <td>{minute.revision_number}</td>
                    </tr>
                  );
                })}
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

          <div className="mp-sign-grid">
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

      <div className="mp-footer">
        {isConfidential && <span className="mp-conf-tag">{CONF_LABELS[conf]} — </span>}
        {SYSTEM_TITLE} — تاریخ چاپ: {printDate} — صفحه‌بندی توسط مرورگر
      </div>
    </div>,
    document.body
  );
}
