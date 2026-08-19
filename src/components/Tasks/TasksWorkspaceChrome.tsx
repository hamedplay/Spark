import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Columns3,
  FolderPlus,
  LayoutGrid,
  List,
  ListFilter,
  Plus,
  Search,
} from 'lucide-react';
import type { PersonalTaskProject } from './PersonalTaskProjects';
import type { TaskStatusFilter, TaskTab, TaskViewMode } from './taskPageSelectors';

interface TasksWorkspaceHeaderProps {
  canCreate: boolean;
  onOpenPersonalProjects: () => void;
  onExport: () => void;
  onCreate: () => void;
}

export function TasksWorkspaceHeader({ canCreate, onOpenPersonalProjects, onExport, onCreate }: TasksWorkspaceHeaderProps) {
  return (
    <div className="flex justify-between items-start flex-wrap gap-3">
      <div>
        <h2 className="text-2xl font-bold dark:text-white">مرکز اقدامات</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">کارتابل، پروژه‌های شخصی، لیست و برد کانبان یکپارچه</p>
      </div>
      <div className="flex gap-2 flex-wrap">
        <button onClick={onOpenPersonalProjects} className="flex items-center gap-2 px-4 py-2 rounded-xl border border-gray-200 dark:border-gray-700 dark:text-gray-200">
          <FolderPlus className="w-4 h-4" /> پروژه شخصی
        </button>
        <button onClick={onExport} className="px-4 py-2 rounded-xl border border-gray-200 dark:border-gray-700 dark:text-gray-200">دریافت اکسل</button>
        {canCreate && (
          <button onClick={onCreate} className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white px-4 py-2 rounded-xl shadow-sm">
            <Plus className="w-4 h-4" /> اقدام جدید
          </button>
        )}
      </div>
    </div>
  );
}

interface TaskMetricCardsProps {
  assignedToMe: number;
  inProgress: number;
  overdue: number;
  completed: number;
  onAssignedToMe: () => void;
  onInProgress: () => void;
  onCompleted: () => void;
}

export function TaskMetricCards(props: TaskMetricCardsProps) {
  const openOverdue = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete('task');
    url.searchParams.set('taskView', 'overdue');
    window.location.assign(url.toString());
  };

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <button onClick={props.onAssignedToMe} className="text-right rounded-2xl border border-violet-200 dark:border-violet-900/50 bg-violet-50/40 dark:bg-violet-950/10 p-4">
        <div className="flex items-center justify-between"><span className="text-sm text-gray-500">کارتابل من</span><ClipboardList className="w-4 h-4 text-violet-500" /></div>
        <div className="text-2xl font-bold mt-2 dark:text-white">{props.assignedToMe}</div>
      </button>
      <button onClick={props.onInProgress} className="text-right rounded-2xl border border-blue-200 dark:border-blue-900/50 bg-blue-50/40 dark:bg-blue-950/10 p-4">
        <div className="flex items-center justify-between"><span className="text-sm text-gray-500">در حال انجام</span><Columns3 className="w-4 h-4 text-blue-500" /></div>
        <div className="text-2xl font-bold mt-2 dark:text-white">{props.inProgress}</div>
      </button>
      <button onClick={openOverdue} className="text-right rounded-2xl border border-red-200 dark:border-red-900/50 bg-red-50/40 dark:bg-red-950/10 p-4">
        <div className="flex items-center justify-between"><span className="text-sm text-gray-500">سررسید گذشته</span><AlertTriangle className="w-4 h-4 text-red-500" /></div>
        <div className="text-2xl font-bold mt-2 dark:text-white">{props.overdue}</div>
      </button>
      <button onClick={props.onCompleted} className="text-right rounded-2xl border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/40 dark:bg-emerald-950/10 p-4">
        <div className="flex items-center justify-between"><span className="text-sm text-gray-500">تکمیل شده</span><CheckCircle2 className="w-4 h-4 text-emerald-500" /></div>
        <div className="text-2xl font-bold mt-2 dark:text-white">{props.completed}</div>
      </button>
    </div>
  );
}

interface TaskViewTabsProps {
  taskTab: TaskTab;
  setTaskTab: (tab: TaskTab) => void;
  createdByMeCount: number;
  viewMode: TaskViewMode;
  setViewMode: (mode: TaskViewMode) => void;
}

export function TaskViewTabs({ taskTab, setTaskTab, createdByMeCount, viewMode, setViewMode }: TaskViewTabsProps) {
  const tabClass = (active: boolean) => `px-4 py-2 rounded-lg text-sm whitespace-nowrap ${active ? 'bg-white dark:bg-gray-700 text-violet-600 shadow-sm' : 'text-gray-500'}`;
  const viewClass = (active: boolean) => `p-2.5 rounded-xl border ${active ? 'border-violet-400 text-violet-600 bg-violet-50 dark:bg-violet-950/20' : 'border-gray-200 dark:border-gray-700 text-gray-500'}`;
  return (
    <div className="flex flex-col 2xl:flex-row 2xl:items-center 2xl:justify-between gap-3">
      <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 rounded-xl p-1 overflow-x-auto">
        <button onClick={() => setTaskTab('assigned_to_me')} className={tabClass(taskTab === 'assigned_to_me')}>کارتابل من</button>
        <button onClick={() => setTaskTab('created_by_me')} className={tabClass(taskTab === 'created_by_me')}>ایجاد شده توسط من ({createdByMeCount})</button>
        <button onClick={() => setTaskTab('all')} className={tabClass(taskTab === 'all')}>همه اقدامات</button>
      </div>
      <div className="flex items-center gap-2">
        <button onClick={() => setViewMode('cards')} title="کارت" className={viewClass(viewMode === 'cards')}><LayoutGrid className="w-4 h-4" /></button>
        <button onClick={() => setViewMode('list')} title="لیست" className={viewClass(viewMode === 'list')}><List className="w-4 h-4" /></button>
        <button onClick={() => setViewMode('kanban')} title="کانبان" className={viewClass(viewMode === 'kanban')}><Columns3 className="w-4 h-4" /></button>
      </div>
    </div>
  );
}

interface TaskFiltersProps {
  searchTerm: string;
  setSearchTerm: (value: string) => void;
  statusFilter: TaskStatusFilter;
  setStatusFilter: (value: TaskStatusFilter) => void;
  personalProjectFilter: string;
  setPersonalProjectFilter: (value: string) => void;
  personalProjects: PersonalTaskProject[];
}

export function TaskFilters({
  searchTerm,
  setSearchTerm,
  statusFilter,
  setStatusFilter,
  personalProjectFilter,
  setPersonalProjectFilter,
  personalProjects,
}: TaskFiltersProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_auto] gap-3">
      <div className="relative">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
        <input value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="جستجو در عنوان، توضیحات و برچسب‌ها..." className="w-full pr-10 pl-4 py-2.5 border border-gray-300 dark:border-gray-700 rounded-xl dark:bg-gray-800 dark:text-white text-sm" />
      </div>
      <div className="relative">
        <ListFilter className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4 pointer-events-none" />
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as TaskStatusFilter)} className="pr-10 pl-4 py-2.5 border border-gray-300 dark:border-gray-700 rounded-xl dark:bg-gray-800 dark:text-white text-sm">
          <option value="all">همه وضعیت‌ها</option><option value="pending">در انتظار</option><option value="in_progress">در حال انجام</option><option value="completed">تکمیل شده</option><option value="archived">بایگانی</option>
        </select>
      </div>
      <select value={personalProjectFilter} onChange={e => setPersonalProjectFilter(e.target.value)} className="px-4 py-2.5 border border-gray-300 dark:border-gray-700 rounded-xl dark:bg-gray-800 dark:text-white text-sm">
        <option value="all">همه پروژه‌های شخصی</option><option value="none">بدون پروژه شخصی</option>
        {personalProjects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
      </select>
    </div>
  );
}
