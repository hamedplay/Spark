import type {
  MinutesStatus, ConfidentialityLevel, ApprovalMode, ApprovalStatus,
  DecisionPriority, DecisionStatus,
} from '../types';
import { gregorianToJalaliDate, toPersianDigits } from '../../lib/minutesDate';

export interface DocMinute {
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

export interface DocInternalPart {
  id: string;
  name_snapshot: string;
  position_snapshot: string | null;
  org_unit_name_snapshot: string | null;
  attendance_status: string | null;
  delegate_name: string | null;
}

export interface DocExternalPart {
  id: string;
  full_name: string;
  organization: string | null;
  position: string | null;
  attendance_status: string | null;
}

export interface DocAgendaItem {
  id: string;
  order: number;
  title: string;
  description: string;
  presenter: string;
  allocatedTime: string | null;
}

export interface DocDecision {
  id: string;
  title: string;
  description: string;
  primaryOwnerName: string;
  responsibleUnitName: string | null;
  priority: DecisionPriority;
  startDate: string;
  dueDate: string;
  status: DecisionStatus;
  progressPercent: number;
  latestUpdate: string;
  discussionResult: string;
  resultType: string;
  additionalNotes: string;
}

export interface DocApproval {
  id: string;
  approver_name: string;
  status: ApprovalStatus;
  approved_at: string | null;
  changes_requested_at: string | null;
}

export interface DocApprovalComment {
  id: string;
  agenda_result_id: string | null;
  reason: string;
  suggested_correction: string | null;
  created_by_name: string;
  created_at: string;
}

export interface MinutesDocumentData {
  minute: DocMinute;
  internalParts: DocInternalPart[];
  externalParts: DocExternalPart[];
  agendaItems: DocAgendaItem[];
  decisions: DocDecision[];
  approvals: DocApproval[];
  approvalComments: DocApprovalComment[];
  logoUrl: string | null;
  config?: MinutesLayoutConfig;
}

export interface MinutesLayoutConfig {
  headerTitle: string;
  orgName: string;
  subtitle: string;
  footerText: string;
  showLogo: boolean;
  showParticipants: boolean;
  showApprovers: boolean;
  showConfidentiality: boolean;
  showDecisions: boolean;
  fontSize: string;
}

export const DASH = '—';

export function orDash(v: string | null | undefined): string {
  if (v === null || v === undefined || v === '') return DASH;
  return v;
}

export function faDate(iso: string | null): string {
  if (!iso) return DASH;
  // Date-only values: try Jalali conversion first (no timezone shift),
  // then fall back to locale formatting for legacy timestamp inputs.
  const jalali = gregorianToJalaliDate(iso);
  if (jalali) return toPersianDigits(jalali);
  try { return new Date(iso).toLocaleDateString('fa-IR'); }
  catch { return iso; }
}

export function faDateTime(iso: string | null): string {
  if (!iso) return DASH;
  try { return new Date(iso).toLocaleString('fa-IR'); }
  catch { return iso; }
}

export const STATUS_LABELS: Record<MinutesStatus, string> = {
  draft: 'پیش‌نویس',
  pending_approval: 'در انتظار تأیید',
  changes_requested: 'درخواست اصلاح',
  approved: 'تأییدشده',
  published: 'منتشرشده',
};

export const CONF_LABELS: Record<ConfidentialityLevel, string> = {
  public: 'عمومی',
  organizational: 'سازمانی',
  restricted: 'محدود',
  confidential: 'محرمانه',
};

export function formatConfidentiality(value: string | null | undefined): string {
  if (!value) return DASH;
  return CONF_LABELS[value as ConfidentialityLevel] || value;
}

export const APPROVAL_MODE_LABELS: Record<ApprovalMode, string> = {
  system: 'سیستمی',
  in_person: 'حضوری',
};

export const APPROVAL_STATUS_LABELS: Record<ApprovalStatus, string> = {
  pending: 'در انتظار',
  approved: 'تأییدشده',
  changes_requested: 'درخواست اصلاح',
  invalidated: 'باطل‌شده',
};

export const AGENDA_RESULT_LABELS: Record<string, string> = {
  discussion: 'بحث و بررسی',
  action: 'اقدام اجرایی',
  resolution: 'مصوبه',
  deferred: 'موکول‌شده',
  no_result: 'بدون نتیجه',
};

export const PRIORITY_LABELS: Record<DecisionPriority, string> = {
  low: 'کم',
  normal: 'عادی',
  important: 'مهم',
  urgent: 'فوری',
};

export const DECISION_STATUS_LABELS: Record<DecisionStatus, string> = {
  not_started: 'شروع‌نشده',
  planned: 'برنامه‌ریزی‌شده',
  in_progress: 'در حال انجام',
  waiting_coordination: 'منتظر هماهنگی',
  waiting_approval: 'منتظر تأیید',
  completed: 'تکمیل‌شده',
  stopped: 'متوقف‌شده',
};

export const MEETING_TYPE_LABELS: Record<string, string> = {
  board: 'هیئت مدیره',
  management: 'مدیریتی',
};

export function formatMeetingType(value: string | null | undefined): string {
  if (!value) return DASH;
  return MEETING_TYPE_LABELS[value] || value;
}

export const SYSTEM_TITLE = 'سامانه مدیریت جلسات';

export const FALLBACK_LOGO = '/logo_spark.png';

export function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
