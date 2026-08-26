import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ClipboardCheck,
  Filter,
  FileText,
  History,
  ListTodo,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  Target,
  UserRound,
  UsersRound,
  X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../lib/supabase';

type DetailTab = 'decisions' | 'tasks';
type WorkspaceTab = 'minutes' | DetailTab;
type DetailTarget = { type: DetailTab; id: string } | null;

interface WorkspaceFocus {
  tab: WorkspaceTab;
  view: string;
  label: string;
  requestId: number;
}

interface ManagementCapabilities {
  decisions_view: boolean;
  decisions_manage: boolean;
  tasks_view: boolean;
  tasks_manage: boolean;
}

interface ScopePerson {
  user_id: string;
  full_name: string;
  unit_id: string | null;
  unit_name: string;
  position_id: string | null;
  position_title: string | null;
}

interface MinuteRow {
  id: string;
  meeting_id: string;
  meeting_title_snapshot: string | null;
  meeting_date_snapshot: string | null;
  meeting_start_time_snapshot: string | null;
  org_unit_id: string | null;
  unit_name: string;
  secretary_name_snapshot: string | null;
  chair_name_snapshot: string | null;
  status: string;
  revision_number: number;
  created_at: string;
  updated_at: string;
}

interface DecisionRow {
  id: string;
  parent_decision_id: string | null;
  decision_group_id: string;
  minute_id: string;
  title: string;
  description: string | null;
  status: string;
  progress_percent: number;
  priority: string;
  start_date: string | null;
  due_date: string | null;
  completed_at: string | null;
  requires_followup: boolean;
  latest_update: string | null;
  primary_owner_user_id: string | null;
  owner_name: string;
  responsible_unit_id: string | null;
  unit_name: string;
  minute_title: string | null;
  meeting_date_snapshot: string | null;
  updated_at: string;
  overdue: boolean;
  open_obstacle_count: number;
}

interface TaskRow {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  due_date: string | null;
  due_local_date: string | null;
  start_date: string | null;
  progress_percent: number;
  assignee: string | null;
  current_assignee_id: string | null;
  assignee_name: string | null;
  user_id: string;
  created_by_id: string | null;
  tags: string[] | null;
  parent_task_id: string | null;
  created_at: string;
}

interface DecisionHistoryItem {
  id: string;
  previous_status: string | null;
  new_status: string | null;
  previous_progress_percent: number | null;
  new_progress_percent: number | null;
  update_text: string | null;
  event_type: string | null;
  event_title: string | null;
  event_metadata: Record<string, unknown> | null;
  is_blocking: boolean;
  resolved_at: string | null;
  actor_name: string | null;
  created_at: string;
}

interface DecisionDetail {
  decision: DecisionRow & {
    discussion_result?: string | null;
    result_type?: string | null;
    additional_notes?: string | null;
    minute_status?: string | null;
    meeting_date?: string | null;
  };
  history: DecisionHistoryItem[];
  can_manage: boolean;
}

interface TaskWorkflowItem {
  id: string;
  action: string;
  note: string | null;
  actor_name: string | null;
  from_name: string | null;
  to_name: string | null;
  created_at: string;
}

interface TaskChecklistItem {
  id: string;
  title: string;
  is_completed: boolean;
  sort_order: number;
  completed_at: string | null;
}

interface TaskDependencyItem {
  id: string;
  depends_on_task_id: string;
  title: string | null;
  status: string | null;
  created_at: string;
}

interface TaskAttachmentItem {
  id: string;
  file_name: string;
  file_size: number | null;
  mime_type: string | null;
  created_at: string;
}

interface TaskDetail {
  task: TaskRow;
  workflow: TaskWorkflowItem[];
  checklist: TaskChecklistItem[];
  dependencies: TaskDependencyItem[];
  attachments: TaskAttachmentItem[];
  can_manage: boolean;
}

const nf = new Intl.NumberFormat('fa-IR');
const dateFormatter = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const dateTimeFormatter = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

const minuteStatusLabels: Record<string, string> = {
  draft: 'پیش‌نویس',
  pending_approval: 'منتظر تأیید',
  changes_requested: 'نیازمند اصلاح',
  approved: 'تأییدشده',
  published: 'منتشرشده',
};

const decisionStatusLabels: Record<string, string> = {
  not_started: 'شروع نشده',
  planned: 'برنامه‌ریزی‌شده',
  in_progress: 'در حال انجام',
  waiting_coordination: 'منتظر هماهنگی',
  waiting_approval: 'منتظر تأیید',
  completed: 'تکمیل‌شده',
  stopped: 'متوقف‌شده',
};

const taskStatusLabels: Record<string, string> = {
  pending: 'در انتظار',
  in_progress: 'در حال انجام',
  completed: 'تکمیل‌شده',
};

const priorityLabels: Record<string, string> = {
  low: 'کم',
  medium: 'متوسط',
  high: 'بالا',
};

function safeNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value.length <= 10 ? `${value}T12:00:00Z` : value);
  return Number.isNaN(date.getTime()) ? value : dateFormatter.format(date);
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : dateTimeFormatter.format(date);
}

function normalizeList<T>(data: unknown): { rows: T[]; total_count: number } {
  if (!data || typeof data !== 'object') return { rows: [], total_count: 0 };
  const source = data as { rows?: unknown; total_count?: unknown };
  return {
    rows: Array.isArray(source.rows) ? (source.rows as T[]) : [],
    total_count: safeNumber(source.total_count),
  };
}

function ProgressBar({ value }: { value: number }) {
  const safe = Math.max(0, Math.min(100, safeNumber(value)));
  return (
    <div className="mt-2">
      <div className="mb-1 flex items-center justify-between text-[9px] text-slate-500">
        <span>پیشرفت</span>
        <span>{nf.format(safe)}٪</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
        <div className="h-full rounded-full bg-gradient-to-l from-violet-500 via-cyan-400 to-emerald-400" style={{ width: `${safe}%` }} />
      </div>
    </div>
  );
}

function StatusBadge({ status, kind }: { status: string; kind: WorkspaceTab }) {
  const label = kind === 'minutes' ? minuteStatusLabels[status] : kind === 'decisions' ? decisionStatusLabels[status] : taskStatusLabels[status];
  const classes = status === 'completed'
    ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
    : status === 'stopped'
      ? 'border-rose-500/20 bg-rose-500/10 text-rose-300'
      : status === 'in_progress'
        ? 'border-cyan-500/20 bg-cyan-500/10 text-cyan-300'
        : 'border-amber-500/20 bg-amber-500/10 text-amber-300';
  return <span className={`rounded-lg border px-2 py-1 text-[9px] ${classes}`}>{label || status || 'نامشخص'}</span>;
}

function SmallEmpty({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-36 items-center justify-center rounded-2xl border border-dashed border-slate-700/70 px-4 text-center text-xs text-slate-500">{children}</div>;
}

export function ManagementScopeWorkspace({ focus, onOpenMinute, onChanged }: { focus?: WorkspaceFocus | null; onOpenMinute?: (minuteId: string) => void; onChanged?: () => void }) {
  const [tab, setTab] = useState<WorkspaceTab>('decisions');
  const [capabilities, setCapabilities] = useState<ManagementCapabilities | null>(null);
  const [people, setPeople] = useState<ScopePerson[]>([]);
  const [minutes, setMinutes] = useState<MinuteRow[]>([]);
  const [decisions, setDecisions] = useState<DecisionRow[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [minuteTotal, setMinuteTotal] = useState(0);
  const [decisionTotal, setDecisionTotal] = useState(0);
  const [taskTotal, setTaskTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [personFilter, setPersonFilter] = useState('');
  const [viewFilter, setViewFilter] = useState('all');
  const [viewLabel, setViewLabel] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [detailTarget, setDetailTarget] = useState<DetailTarget>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [decisionDetail, setDecisionDetail] = useState<DecisionDetail | null>(null);
  const [taskDetail, setTaskDetail] = useState<TaskDetail | null>(null);
  const [saving, setSaving] = useState(false);

  const [decisionStatus, setDecisionStatus] = useState('');
  const [decisionProgress, setDecisionProgress] = useState(0);
  const [decisionNote, setDecisionNote] = useState('');

  const [taskStatus, setTaskStatus] = useState('');
  const [taskProgress, setTaskProgress] = useState(0);
  const [taskPriority, setTaskPriority] = useState('medium');
  const [taskDueDate, setTaskDueDate] = useState('');
  const [taskAssignee, setTaskAssignee] = useState('');
  const [taskNote, setTaskNote] = useState('');

  const loadLists = useCallback(async (
    silent = false,
    overrides?: { search?: string; status?: string; person?: string; tab?: WorkspaceTab; view?: string },
  ) => {
    const targetTab = overrides?.tab ?? tab;
    const effectiveSearch = overrides?.search ?? search;
    const effectiveStatus = overrides?.status ?? statusFilter;
    const effectivePerson = overrides?.person ?? personFilter;
    const effectiveView = overrides?.view ?? viewFilter;
    if (silent) setRefreshing(true); else setLoading(true);
    try {
      const [capResult, peopleResult] = await Promise.all([
        supabase.rpc('get_management_capabilities_v1'),
        supabase.rpc('get_management_scope_people_v1'),
      ]);
      if (capResult.error) throw capResult.error;
      if (peopleResult.error) throw peopleResult.error;

      const caps = capResult.data as unknown as ManagementCapabilities;
      setCapabilities(caps);
      setPeople(Array.isArray(peopleResult.data) ? peopleResult.data as unknown as ScopePerson[] : []);

      const [minuteResult, decisionResult, taskResult] = await Promise.all([
        supabase.rpc('get_management_minutes_v1', {
          p_search: effectiveSearch.trim() || null,
          p_status: targetTab === 'minutes' ? (effectiveStatus || null) : null,
          p_view: targetTab === 'minutes' ? effectiveView : 'all',
          p_limit: 250,
          p_offset: 0,
        }),
        caps?.decisions_view ? supabase.rpc('get_management_decisions_v3', {
          p_search: effectiveSearch.trim() || null,
          p_status: targetTab === 'decisions' ? (effectiveStatus || null) : null,
          p_unit_id: null,
          p_owner_user_id: targetTab === 'decisions' ? (effectivePerson || null) : null,
          p_view: targetTab === 'decisions' ? effectiveView : 'all',
          p_limit: 250,
          p_offset: 0,
        }) : Promise.resolve({ data: { rows: [], total_count: 0 }, error: null }),
        caps?.tasks_view ? supabase.rpc('get_management_tasks_v2', {
          p_search: effectiveSearch.trim() || null,
          p_status: targetTab === 'tasks' ? (effectiveStatus || null) : null,
          p_assignee_user_id: targetTab === 'tasks' ? (effectivePerson || null) : null,
          p_view: targetTab === 'tasks' ? effectiveView : 'all',
          p_limit: 250,
          p_offset: 0,
        }) : Promise.resolve({ data: { rows: [], total_count: 0 }, error: null }),
      ]);
      if (minuteResult.error) throw minuteResult.error;
      if (decisionResult.error) throw decisionResult.error;
      if (taskResult.error) throw taskResult.error;

      const minuteList = normalizeList<MinuteRow>(minuteResult.data);
      const decisionList = normalizeList<DecisionRow>(decisionResult.data);
      const taskList = normalizeList<TaskRow>(taskResult.data);
      setMinutes(minuteList.rows);
      setMinuteTotal(minuteList.total_count);
      setDecisions(decisionList.rows);
      setDecisionTotal(decisionList.total_count);
      setTasks(taskList.rows);
      setTaskTotal(taskList.total_count);
    } catch (error) {
      console.error('[ManagementScopeWorkspace] load failed', error);
      toast.error('بارگذاری فضای مدیریت زیرمجموعه ناموفق بود');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [personFilter, search, statusFilter, tab, viewFilter]);

  useEffect(() => { void loadLists(); }, []); // initial load only

  useEffect(() => {
    if (!focus) return;
    setTab(focus.tab);
    setSearch('');
    setStatusFilter('');
    setPersonFilter('');
    setViewFilter(focus.view || 'all');
    setViewLabel(focus.label || '');
    void loadLists(true, { tab: focus.tab, view: focus.view || 'all', search: '', status: '', person: '' });
  }, [focus?.requestId]);

  const applyFilters = useCallback(() => { void loadLists(true); }, [loadLists]);

  const clearFilters = useCallback(() => {
    setSearch('');
    setStatusFilter('');
    setPersonFilter('');
    setViewFilter('all');
    setViewLabel('');
    void loadLists(true, { search: '', status: '', person: '', view: 'all' });
  }, [loadLists]);

  const switchTab = useCallback((nextTab: WorkspaceTab) => {
    setTab(nextTab);
    setSearch('');
    setStatusFilter('');
    setPersonFilter('');
    setViewFilter('all');
    setViewLabel('');
    void loadLists(true, { tab: nextTab, search: '', status: '', person: '', view: 'all' });
  }, [loadLists]);

  const openDecision = useCallback(async (id: string) => {
    setDetailTarget({ type: 'decisions', id });
    setDecisionDetail(null);
    setTaskDetail(null);
    setDetailLoading(true);
    try {
      const { data, error } = await supabase.rpc('get_management_decision_detail_v1', { p_decision_id: id });
      if (error) throw error;
      const detail = data as unknown as DecisionDetail;
      setDecisionDetail(detail);
      setDecisionStatus(detail.decision.status || 'not_started');
      setDecisionProgress(safeNumber(detail.decision.progress_percent));
      setDecisionNote('');
    } catch (error) {
      console.error('[ManagementScopeWorkspace] decision detail failed', error);
      toast.error('دریافت جزئیات مصوبه ناموفق بود');
      setDetailTarget(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const openTask = useCallback(async (id: string) => {
    setDetailTarget({ type: 'tasks', id });
    setDecisionDetail(null);
    setTaskDetail(null);
    setDetailLoading(true);
    try {
      const { data, error } = await supabase.rpc('get_management_task_detail_v1', { p_task_id: id });
      if (error) throw error;
      const detail = data as unknown as TaskDetail;
      setTaskDetail(detail);
      setTaskStatus(detail.task.status || 'pending');
      setTaskProgress(safeNumber(detail.task.progress_percent));
      setTaskPriority(detail.task.priority || 'medium');
      setTaskDueDate(detail.task.due_date?.slice(0, 10) || '');
      setTaskAssignee(detail.task.current_assignee_id || '');
      setTaskNote('');
    } catch (error) {
      console.error('[ManagementScopeWorkspace] task detail failed', error);
      toast.error('دریافت جزئیات اقدام ناموفق بود');
      setDetailTarget(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const saveDecision = useCallback(async () => {
    if (!decisionDetail) return;
    setSaving(true);
    try {
      const { error } = await supabase.rpc('manage_management_decision_v1', {
        p_decision_id: decisionDetail.decision.id,
        p_expected_updated_at: decisionDetail.decision.updated_at,
        p_status: decisionStatus,
        p_progress_percent: decisionProgress,
        p_report_text: decisionNote.trim() || null,
      });
      if (error) throw error;
      toast.success('مصوبه با ثبت تاریخچه مدیریتی بروزرسانی شد');
      await Promise.all([openDecision(decisionDetail.decision.id), loadLists(true)]);
      onChanged?.();
    } catch (error) {
      console.error('[ManagementScopeWorkspace] decision save failed', error);
      const message = error instanceof Error && error.message.includes('DECISION_VERSION_CONFLICT')
        ? 'مصوبه هم‌زمان توسط فرد دیگری تغییر کرده است؛ جزئیات را دوباره باز کنید'
        : 'بروزرسانی مدیریتی مصوبه ناموفق بود';
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }, [decisionDetail, decisionNote, decisionProgress, decisionStatus, loadLists, onChanged, openDecision]);

  const saveTask = useCallback(async () => {
    if (!taskDetail) return;
    setSaving(true);
    try {
      const { error } = await supabase.rpc('manage_management_task_v1', {
        p_task_id: taskDetail.task.id,
        p_status: taskStatus,
        p_progress_percent: taskProgress,
        p_priority: taskPriority,
        p_due_date: taskDueDate || null,
        p_assignee_user_id: taskAssignee || null,
        p_note: taskNote.trim() || null,
      });
      if (error) throw error;
      toast.success('اقدام با ثبت مرحله مدیریتی بروزرسانی شد');
      await Promise.all([openTask(taskDetail.task.id), loadLists(true)]);
      onChanged?.();
    } catch (error) {
      console.error('[ManagementScopeWorkspace] task save failed', error);
      toast.error('بروزرسانی مدیریتی اقدام ناموفق بود');
    } finally {
      setSaving(false);
    }
  }, [loadLists, onChanged, openTask, taskAssignee, taskDetail, taskDueDate, taskNote, taskPriority, taskProgress, taskStatus]);

  const activeRows = tab === 'minutes' ? minutes : tab === 'decisions' ? decisions : tasks;
  const activeTotal = tab === 'minutes' ? minuteTotal : tab === 'decisions' ? decisionTotal : taskTotal;
  const canViewActive = tab === 'minutes' ? true : tab === 'decisions' ? capabilities?.decisions_view : capabilities?.tasks_view;

  const statusOptions = useMemo(() => tab === 'minutes'
    ? Object.entries(minuteStatusLabels)
    : tab === 'decisions'
      ? Object.entries(decisionStatusLabels)
      : Object.entries(taskStatusLabels), [tab]);

  if (loading) {
    return <section className="rounded-2xl border border-slate-700/60 bg-slate-950/35 p-5"><div className="flex min-h-48 items-center justify-center gap-3 text-sm text-slate-400"><Loader2 className="h-6 w-6 animate-spin text-violet-400" />در حال آماده‌سازی فضای مدیریت زیرمجموعه...</div></section>;
  }

  return (
    <>
      <section className="overflow-hidden rounded-2xl border border-violet-500/20 bg-gradient-to-b from-violet-500/[0.07] to-slate-950/30 shadow-[0_18px_55px_rgba(0,0,0,0.18)]">
        <div className="flex flex-col gap-3 border-b border-slate-800/80 p-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-400/25 bg-violet-500/10 px-2.5 py-1 text-[10px] font-semibold text-violet-300"><ShieldCheck className="h-3.5 w-3.5" />حوزه مدیریتی سازمانی</span>
              <span className="rounded-full border border-slate-700 bg-slate-900/60 px-2.5 py-1 text-[10px] text-slate-500">{nf.format(people.length)} کاربر در زیرمجموعه</span>
            </div>
            <h3 className="mt-2 text-base font-black text-white">صورت‌جلسات، مصوبات و اقدامات زیرمجموعه</h3>
            <p className="mt-1 text-[11px] text-slate-500">مشاهده جزئیات، مراحل و مدیریت عملیاتی فقط در محدوده سازمانی مجاز شما</p>
          </div>
          <button type="button" onClick={() => void loadLists(true)} disabled={refreshing} className="inline-flex self-start items-center gap-2 rounded-xl border border-slate-700 bg-slate-900/60 px-3 py-2 text-[11px] text-slate-300 transition hover:border-violet-500/35 hover:text-white disabled:opacity-50"><RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />بروزرسانی</button>
        </div>

        <div className="p-4">
          <div className="mb-3 grid grid-cols-3 gap-2 rounded-xl bg-slate-950/45 p-1">
            <button type="button" onClick={() => switchTab('minutes')} className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-xs font-semibold transition ${tab === 'minutes' ? 'bg-blue-500/15 text-blue-200 shadow-sm' : 'text-slate-500 hover:text-slate-300'}`}><FileText className="h-4 w-4" />صورت‌جلسات <span className="rounded-md bg-slate-950/50 px-1.5 py-0.5 text-[9px]">{nf.format(minuteTotal)}</span></button>
            <button type="button" onClick={() => switchTab('decisions')} className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-xs font-semibold transition ${tab === 'decisions' ? 'bg-violet-500/15 text-violet-200 shadow-sm' : 'text-slate-500 hover:text-slate-300'}`}><Target className="h-4 w-4" />مصوبات <span className="rounded-md bg-slate-950/50 px-1.5 py-0.5 text-[9px]">{nf.format(decisionTotal)}</span></button>
            <button type="button" onClick={() => switchTab('tasks')} className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-xs font-semibold transition ${tab === 'tasks' ? 'bg-cyan-500/15 text-cyan-200 shadow-sm' : 'text-slate-500 hover:text-slate-300'}`}><ListTodo className="h-4 w-4" />اقدامات <span className="rounded-md bg-slate-950/50 px-1.5 py-0.5 text-[9px]">{nf.format(taskTotal)}</span></button>
          </div>

          {viewLabel && <div className="mb-3 flex items-center justify-between gap-2 rounded-xl border border-violet-500/20 bg-violet-500/[0.06] px-3 py-2 text-[10px] text-violet-200"><span>فیلتر فعال: {viewLabel}</span><button type="button" onClick={clearFilters} className="text-violet-300 hover:text-white">نمایش همه</button></div>}

          <div className={`mb-3 grid gap-2 ${tab === 'minutes' ? 'md:grid-cols-[minmax(0,1fr)_180px_auto]' : 'md:grid-cols-[minmax(0,1fr)_180px_220px_auto]'}`}>
            <label className="relative block"><Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-600" /><input value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') applyFilters(); }} placeholder={tab === 'minutes' ? 'جستجو در عنوان یا واحد صورت‌جلسه...' : tab === 'decisions' ? 'جستجو در عنوان، شرح یا صورتجلسه...' : 'جستجو در عنوان یا شرح اقدام...'} className="h-10 w-full rounded-xl border border-slate-700/80 bg-slate-950/55 pr-9 pl-3 text-xs text-slate-200 outline-none transition placeholder:text-slate-600 focus:border-violet-500/50" /></label>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="h-10 rounded-xl border border-slate-700/80 bg-slate-950/55 px-3 text-xs text-slate-300 outline-none focus:border-violet-500/50"><option value="">همه وضعیت‌ها</option>{statusOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
            {tab !== 'minutes' && <select value={personFilter} onChange={(event) => setPersonFilter(event.target.value)} className="h-10 rounded-xl border border-slate-700/80 bg-slate-950/55 px-3 text-xs text-slate-300 outline-none focus:border-violet-500/50"><option value="">همه افراد زیرمجموعه</option>{people.map((person) => <option key={person.user_id} value={person.user_id}>{person.full_name} — {person.unit_name}</option>)}</select>}
            <div className="flex gap-2"><button type="button" onClick={applyFilters} className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-violet-600 px-3 text-[11px] font-semibold text-white transition hover:bg-violet-500"><Filter className="h-3.5 w-3.5" />اعمال</button><button type="button" onClick={clearFilters} className="h-10 rounded-xl border border-slate-700 px-3 text-[11px] text-slate-500 transition hover:text-slate-300">پاک</button></div>
          </div>

          {!canViewActive ? <SmallEmpty>برای مشاهده {tab === 'decisions' ? 'مصوبات' : 'اقدامات'} زیرمجموعه Permission لازم به این سمت داده نشده است.</SmallEmpty> : activeRows.length === 0 ? <SmallEmpty>موردی مطابق فیلترهای انتخابی در حوزه مدیریتی شما وجود ندارد.</SmallEmpty> : (
            <div className="max-h-[520px] space-y-2 overflow-y-auto pl-1">
              {tab === 'minutes' ? minutes.map((item) => (
                <button type="button" key={item.id} onClick={() => onOpenMinute?.(item.id)} className="group block w-full rounded-xl border border-slate-800/80 bg-slate-950/30 p-3 text-right transition hover:border-blue-500/35 hover:bg-slate-900/55 focus:outline-none focus:ring-2 focus:ring-blue-400/30">
                  <div className="flex items-start gap-3"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-start justify-between gap-2"><p className="line-clamp-2 text-xs font-semibold leading-5 text-slate-200">{item.meeting_title_snapshot || 'صورت‌جلسه بدون عنوان'}</p><StatusBadge status={item.status} kind="minutes" /></div><div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-slate-500"><span className="inline-flex items-center gap-1"><UsersRound className="h-3 w-3" />{item.unit_name}</span><span>تاریخ جلسه: {formatDate(item.meeting_date_snapshot)}</span>{item.secretary_name_snapshot && <span>دبیر: {item.secretary_name_snapshot}</span>}</div></div><ChevronLeft className="mt-1 h-4 w-4 flex-shrink-0 text-slate-700 transition group-hover:text-blue-400" /></div>
                </button>
              )) : tab === 'decisions' ? decisions.map((item) => (
                <button type="button" key={item.id} onClick={() => void openDecision(item.id)} className="group block w-full rounded-xl border border-slate-800/80 bg-slate-950/30 p-3 text-right transition hover:border-violet-500/35 hover:bg-slate-900/55 focus:outline-none focus:ring-2 focus:ring-violet-400/30">
                  <div className="flex items-start gap-3"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-start justify-between gap-2"><p className="line-clamp-2 text-xs font-semibold leading-5 text-slate-200">{item.title}</p><StatusBadge status={item.status} kind="decisions" /></div><div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-slate-500"><span className="inline-flex items-center gap-1"><UsersRound className="h-3 w-3" />{item.unit_name}</span><span className="inline-flex items-center gap-1"><UserRound className="h-3 w-3" />{item.owner_name || 'بدون مسئول'}</span><span>مهلت: {formatDate(item.due_date)}</span>{item.overdue && <span className="text-rose-300">عقب‌مانده</span>}{item.open_obstacle_count > 0 && <span className="text-amber-300">{nf.format(item.open_obstacle_count)} مانع باز</span>}</div><ProgressBar value={item.progress_percent} /></div><ChevronLeft className="mt-1 h-4 w-4 flex-shrink-0 text-slate-700 transition group-hover:text-violet-400" /></div>
                </button>
              )) : tasks.map((item) => (
                <button type="button" key={item.id} onClick={() => void openTask(item.id)} className="group block w-full rounded-xl border border-slate-800/80 bg-slate-950/30 p-3 text-right transition hover:border-cyan-500/35 hover:bg-slate-900/55 focus:outline-none focus:ring-2 focus:ring-cyan-400/30">
                  <div className="flex items-start gap-3"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-start justify-between gap-2"><p className="line-clamp-2 text-xs font-semibold leading-5 text-slate-200">{item.title}</p><StatusBadge status={item.status} kind="tasks" /></div><div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-slate-500"><span className="inline-flex items-center gap-1"><UserRound className="h-3 w-3" />{item.assignee_name || item.assignee || 'بدون مسئول'}</span><span>اولویت: {priorityLabels[item.priority] || item.priority || '—'}</span><span>مهلت: {formatDate(item.due_local_date || item.due_date)}</span></div><ProgressBar value={item.progress_percent} /></div><ChevronLeft className="mt-1 h-4 w-4 flex-shrink-0 text-slate-700 transition group-hover:text-cyan-400" /></div>
                </button>
              ))}
            </div>
          )}
          {canViewActive && <p className="mt-2 text-left text-[9px] text-slate-600">نمایش {nf.format(activeRows.length)} از {nf.format(activeTotal)} مورد</p>}
        </div>
      </section>

      {detailTarget && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/85 p-3 backdrop-blur-sm" onMouseDown={(event) => { if (event.currentTarget === event.target) setDetailTarget(null); }}>
          <section className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl border border-slate-700 bg-[#071426] shadow-2xl" role="dialog" aria-modal="true">
            <header className="flex items-start justify-between gap-3 border-b border-slate-800 px-4 py-4 sm:px-6"><div><div className="flex items-center gap-2 text-[10px] text-slate-500">{detailTarget.type === 'decisions' ? <Target className="h-3.5 w-3.5 text-violet-400" /> : <ListTodo className="h-3.5 w-3.5 text-cyan-400" />}{detailTarget.type === 'decisions' ? 'جزئیات کامل مصوبه' : 'جزئیات کامل اقدام'}</div><h3 className="mt-1 line-clamp-2 text-sm font-black text-white sm:text-base">{detailTarget.type === 'decisions' ? decisionDetail?.decision.title || 'در حال بارگذاری...' : taskDetail?.task.title || 'در حال بارگذاری...'}</h3></div><button type="button" onClick={() => setDetailTarget(null)} className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border border-slate-700 bg-slate-900/60 text-slate-400 transition hover:text-white" aria-label="بستن"><X className="h-4 w-4" /></button></header>
            <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
              {detailLoading ? <div className="flex min-h-64 items-center justify-center gap-3 text-sm text-slate-400"><Loader2 className="h-6 w-6 animate-spin text-violet-400" />در حال دریافت مراحل و جزئیات...</div> : detailTarget.type === 'decisions' && decisionDetail ? (
                <div className="space-y-4">
                  <div className="grid gap-3 lg:grid-cols-[1.1fr_.9fr]">
                    <div className="rounded-2xl border border-slate-800 bg-slate-950/35 p-4"><div className="flex flex-wrap items-center gap-2"><StatusBadge status={decisionDetail.decision.status} kind="decisions" />{decisionDetail.decision.requires_followup && <span className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-2 py-1 text-[9px] text-amber-300">نیازمند پیگیری</span>}</div>{decisionDetail.decision.description && <p className="mt-3 whitespace-pre-wrap text-xs leading-6 text-slate-400">{decisionDetail.decision.description}</p>}<div className="mt-4 grid grid-cols-2 gap-2 text-[10px] text-slate-500 sm:grid-cols-3"><div><span className="block text-slate-600">واحد مسئول</span><span className="mt-1 block text-slate-300">{decisionDetail.decision.unit_name}</span></div><div><span className="block text-slate-600">مسئول اجرا</span><span className="mt-1 block text-slate-300">{decisionDetail.decision.owner_name || '—'}</span></div><div><span className="block text-slate-600">مهلت</span><span className="mt-1 block text-slate-300">{formatDate(decisionDetail.decision.due_date)}</span></div><div><span className="block text-slate-600">صورتجلسه</span><span className="mt-1 line-clamp-2 block text-slate-300">{decisionDetail.decision.minute_title || '—'}</span></div><div><span className="block text-slate-600">تاریخ جلسه</span><span className="mt-1 block text-slate-300">{formatDate(decisionDetail.decision.meeting_date)}</span></div><div><span className="block text-slate-600">آخرین بروزرسانی</span><span className="mt-1 block text-slate-300">{formatDateTime(decisionDetail.decision.updated_at)}</span></div></div><ProgressBar value={decisionDetail.decision.progress_percent} />{decisionDetail.decision.latest_update && <div className="mt-3 rounded-xl bg-slate-900/60 p-3 text-[11px] leading-5 text-slate-400"><span className="font-semibold text-slate-300">آخرین گزارش: </span>{decisionDetail.decision.latest_update}</div>}</div>
                    {decisionDetail.can_manage && <div className="rounded-2xl border border-violet-500/20 bg-violet-500/[0.04] p-4"><h4 className="flex items-center gap-2 text-xs font-bold text-violet-200"><ShieldCheck className="h-4 w-4" />مدیریت عملیاتی مصوبه</h4><p className="mt-1 text-[9px] leading-4 text-slate-600">اصل متن و صورتجلسه تغییر نمی‌کند؛ فقط وضعیت، پیشرفت و گزارش مدیریتی ثبت می‌شود.</p><label className="mt-3 block text-[10px] text-slate-500">وضعیت<select value={decisionStatus} onChange={(event) => setDecisionStatus(event.target.value)} className="mt-1 h-9 w-full rounded-lg border border-slate-700 bg-slate-950/60 px-2 text-xs text-slate-300 outline-none">{Object.entries(decisionStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="mt-3 block text-[10px] text-slate-500">درصد پیشرفت — {nf.format(decisionProgress)}٪<input type="range" min={0} max={100} step={5} value={decisionProgress} onChange={(event) => setDecisionProgress(Number(event.target.value))} className="mt-2 w-full" /></label><label className="mt-3 block text-[10px] text-slate-500">گزارش مدیریتی<textarea value={decisionNote} onChange={(event) => setDecisionNote(event.target.value)} rows={3} placeholder="شرح پیگیری، تصمیم مدیریتی یا گزارش جدید..." className="mt-1 w-full resize-none rounded-lg border border-slate-700 bg-slate-950/60 p-2 text-xs leading-5 text-slate-300 outline-none placeholder:text-slate-700" /></label><button type="button" disabled={saving} onClick={() => void saveDecision()} className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-3 py-2.5 text-xs font-semibold text-white transition hover:bg-violet-500 disabled:opacity-50">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardCheck className="h-4 w-4" />}ثبت بروزرسانی مدیریتی</button></div>}
                  </div>
                  <div className="rounded-2xl border border-slate-800 bg-slate-950/30 p-4"><h4 className="flex items-center gap-2 text-xs font-bold text-slate-200"><History className="h-4 w-4 text-violet-400" />تاریخچه کامل مصوبه <span className="text-[9px] font-normal text-slate-600">{nf.format(decisionDetail.history.length)} رویداد</span></h4>{decisionDetail.history.length ? <div className="mt-3 max-h-[390px] space-y-0 overflow-y-auto pr-1">{decisionDetail.history.map((item) => <div key={item.id} className="relative border-r border-slate-800 pb-4 pr-5 last:pb-0"><span className={`absolute -right-[5px] top-1 h-2.5 w-2.5 rounded-full ring-4 ring-[#071426] ${item.is_blocking && !item.resolved_at ? 'bg-rose-400' : item.event_type === 'status_change' ? 'bg-violet-400' : item.event_type === 'progress' ? 'bg-cyan-400' : 'bg-slate-500'}`} /><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-[11px] font-semibold text-slate-300">{item.event_title || 'بروزرسانی مصوبه'}</p><span className="text-[9px] text-slate-600">{formatDateTime(item.created_at)}</span></div><p className="mt-1 text-[9px] text-slate-600">{item.actor_name || 'سیستم'}{item.previous_progress_percent !== item.new_progress_percent && item.new_progress_percent != null ? ` · پیشرفت ${nf.format(item.new_progress_percent)}٪` : ''}</p>{item.update_text && <p className="mt-2 whitespace-pre-wrap rounded-lg bg-slate-900/45 p-2 text-[10px] leading-5 text-slate-400">{item.update_text}</p>}{item.is_blocking && <span className={`mt-2 inline-block rounded-md px-2 py-1 text-[9px] ${item.resolved_at ? 'bg-emerald-500/10 text-emerald-300' : 'bg-rose-500/10 text-rose-300'}`}>{item.resolved_at ? 'مانع رفع‌شده' : 'مانع باز'}</span>}</div>)}</div> : <SmallEmpty>برای این مصوبه هنوز تاریخچه‌ای ثبت نشده است.</SmallEmpty>}</div>
                </div>
              ) : detailTarget.type === 'tasks' && taskDetail ? (
                <div className="space-y-4">
                  <div className="grid gap-3 lg:grid-cols-[1.1fr_.9fr]">
                    <div className="rounded-2xl border border-slate-800 bg-slate-950/35 p-4"><StatusBadge status={taskDetail.task.status} kind="tasks" />{taskDetail.task.description && <p className="mt-3 whitespace-pre-wrap text-xs leading-6 text-slate-400">{taskDetail.task.description}</p>}<div className="mt-4 grid grid-cols-2 gap-2 text-[10px] text-slate-500 sm:grid-cols-3"><div><span className="block text-slate-600">مسئول</span><span className="mt-1 block text-slate-300">{taskDetail.task.assignee_name || taskDetail.task.assignee || '—'}</span></div><div><span className="block text-slate-600">اولویت</span><span className="mt-1 block text-slate-300">{priorityLabels[taskDetail.task.priority] || taskDetail.task.priority || '—'}</span></div><div><span className="block text-slate-600">مهلت</span><span className="mt-1 block text-slate-300">{formatDate(taskDetail.task.due_date)}</span></div></div><ProgressBar value={taskDetail.task.progress_percent} /><div className="mt-4 grid gap-2 sm:grid-cols-3"><div className="rounded-xl bg-slate-900/50 p-3 text-center"><p className="text-lg font-black text-white">{nf.format(taskDetail.workflow.length)}</p><p className="text-[9px] text-slate-600">مرحله / رویداد</p></div><div className="rounded-xl bg-slate-900/50 p-3 text-center"><p className="text-lg font-black text-white">{nf.format(taskDetail.checklist.filter((item) => item.is_completed).length)}/{nf.format(taskDetail.checklist.length)}</p><p className="text-[9px] text-slate-600">چک‌لیست انجام‌شده</p></div><div className="rounded-xl bg-slate-900/50 p-3 text-center"><p className="text-lg font-black text-white">{nf.format(taskDetail.dependencies.length)}</p><p className="text-[9px] text-slate-600">وابستگی</p></div></div></div>
                    {taskDetail.can_manage && <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/[0.04] p-4"><h4 className="flex items-center gap-2 text-xs font-bold text-cyan-200"><ShieldCheck className="h-4 w-4" />مدیریت اقدام زیرمجموعه</h4><label className="mt-3 block text-[10px] text-slate-500">وضعیت<select value={taskStatus} onChange={(event) => setTaskStatus(event.target.value)} className="mt-1 h-9 w-full rounded-lg border border-slate-700 bg-slate-950/60 px-2 text-xs text-slate-300 outline-none">{Object.entries(taskStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="mt-2 block text-[10px] text-slate-500">مسئول<select value={taskAssignee} onChange={(event) => setTaskAssignee(event.target.value)} className="mt-1 h-9 w-full rounded-lg border border-slate-700 bg-slate-950/60 px-2 text-xs text-slate-300 outline-none"><option value="">بدون تغییر / بدون مسئول</option>{people.map((person) => <option key={person.user_id} value={person.user_id}>{person.full_name} — {person.unit_name}</option>)}</select></label><div className="mt-2 grid grid-cols-2 gap-2"><label className="block text-[10px] text-slate-500">اولویت<select value={taskPriority} onChange={(event) => setTaskPriority(event.target.value)} className="mt-1 h-9 w-full rounded-lg border border-slate-700 bg-slate-950/60 px-2 text-xs text-slate-300 outline-none">{Object.entries(priorityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="block text-[10px] text-slate-500">مهلت<input type="date" value={taskDueDate} onChange={(event) => setTaskDueDate(event.target.value)} className="mt-1 h-9 w-full rounded-lg border border-slate-700 bg-slate-950/60 px-2 text-xs text-slate-300 outline-none" /></label></div><label className="mt-3 block text-[10px] text-slate-500">درصد پیشرفت — {nf.format(taskProgress)}٪<input type="range" min={0} max={100} step={5} value={taskProgress} onChange={(event) => setTaskProgress(Number(event.target.value))} className="mt-2 w-full" /></label><label className="mt-2 block text-[10px] text-slate-500">یادداشت مدیریتی<textarea rows={2} value={taskNote} onChange={(event) => setTaskNote(event.target.value)} className="mt-1 w-full resize-none rounded-lg border border-slate-700 bg-slate-950/60 p-2 text-xs text-slate-300 outline-none" /></label><button type="button" disabled={saving} onClick={() => void saveTask()} className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-600 px-3 py-2.5 text-xs font-semibold text-white transition hover:bg-cyan-500 disabled:opacity-50">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardCheck className="h-4 w-4" />}ثبت بروزرسانی اقدام</button></div>}
                  </div>
                  <div className="grid gap-3 lg:grid-cols-2"><div className="rounded-2xl border border-slate-800 bg-slate-950/30 p-4"><h4 className="flex items-center gap-2 text-xs font-bold text-slate-200"><History className="h-4 w-4 text-cyan-400" />مراحل و گردش اقدام</h4>{taskDetail.workflow.length ? <div className="mt-3 max-h-[340px] space-y-0 overflow-y-auto">{taskDetail.workflow.map((item) => <div key={item.id} className="relative border-r border-slate-800 pb-4 pr-5 last:pb-0"><span className="absolute -right-[5px] top-1 h-2.5 w-2.5 rounded-full bg-cyan-400 ring-4 ring-[#071426]" /><div className="flex justify-between gap-2"><p className="text-[10px] font-semibold text-slate-300">{item.action === 'management_update' ? 'بروزرسانی مدیریتی' : item.action}</p><span className="text-[9px] text-slate-600">{formatDateTime(item.created_at)}</span></div><p className="mt-1 text-[9px] text-slate-600">{item.actor_name || 'سیستم'}{item.to_name ? ` → ${item.to_name}` : ''}</p>{item.note && <p className="mt-2 rounded-lg bg-slate-900/45 p-2 text-[10px] leading-5 text-slate-400">{item.note}</p>}</div>)}</div> : <SmallEmpty>مرحله‌ای ثبت نشده است.</SmallEmpty>}</div><div className="space-y-3"><div className="rounded-2xl border border-slate-800 bg-slate-950/30 p-4"><h4 className="flex items-center gap-2 text-xs font-bold text-slate-200"><CheckCircle2 className="h-4 w-4 text-emerald-400" />چک‌لیست</h4>{taskDetail.checklist.length ? <div className="mt-3 max-h-44 space-y-2 overflow-y-auto">{taskDetail.checklist.map((item) => <div key={item.id} className="flex items-start gap-2 text-[10px]"><span className={`mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded ${item.is_completed ? 'bg-emerald-500/15 text-emerald-300' : 'bg-slate-800 text-slate-600'}`}>{item.is_completed ? '✓' : ''}</span><span className={item.is_completed ? 'text-slate-500 line-through' : 'text-slate-300'}>{item.title}</span></div>)}</div> : <p className="mt-3 text-[10px] text-slate-600">چک‌لیستی ندارد.</p>}</div><div className="rounded-2xl border border-slate-800 bg-slate-950/30 p-4"><div className="grid grid-cols-2 gap-3 text-center"><div><p className="text-lg font-bold text-white">{nf.format(taskDetail.dependencies.length)}</p><p className="text-[9px] text-slate-600">وابستگی‌ها</p></div><div><p className="text-lg font-bold text-white">{nf.format(taskDetail.attachments.length)}</p><p className="text-[9px] text-slate-600">پیوست‌ها</p></div></div>{taskDetail.dependencies.length > 0 && <div className="mt-3 space-y-1">{taskDetail.dependencies.slice(0, 4).map((item) => <p key={item.id} className="truncate text-[9px] text-slate-500">• {item.title || item.depends_on_task_id}</p>)}</div>}{taskDetail.attachments.length > 0 && <div className="mt-3 space-y-1 border-t border-slate-800 pt-2">{taskDetail.attachments.slice(0, 4).map((item) => <p key={item.id} className="truncate text-[9px] text-slate-500">📎 {item.file_name}</p>)}</div>}</div></div></div>
                </div>
              ) : <SmallEmpty><span className="inline-flex items-center gap-2"><AlertTriangle className="h-4 w-4" />جزئیات قابل نمایش نیست.</span></SmallEmpty>}
            </div>
          </section>
        </div>
      )}
    </>
  );
}
