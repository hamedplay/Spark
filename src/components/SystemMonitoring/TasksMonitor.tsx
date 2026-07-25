import React, { useState, useEffect, useCallback, useRef } from 'react';
import { SquareCheck as CheckSquare, Users, ListFilter as Filter, Search, EllipsisVertical as MoreVertical, CreditCard as Edit2, Trash2, GitBranch, X, Loader as Loader2, RefreshCw } from 'lucide-react';
import { type TaskRow, type TaskWorkflowStep, type GroupTaskRow, type Profile } from './types';
import { toJalali, jalaliToGregorian, SEL, priorityLabel, priorityColor, statusLabel, statusColor } from './utils';
import { Badge2, DataField } from './DisplayComponents';
import { JalaliInput } from './JalaliInput';
import { TaskFlowModal } from './TaskFlowModal';
import { TaskEditModal } from './TaskEditModal';
import { ConfirmDeleteModal } from './ConfirmDeleteModal';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';

function TasksMonitor({ profiles }: { profiles: Profile[] }) {
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [groupTasks, setGroupTasks] = useState<GroupTaskRow[]>([]);
  const [activeTab, setActiveTab] = useState<'tasks' | 'group'>('tasks');
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterPriority, setFilterPriority] = useState('all');
  const [filterUser, setFilterUser] = useState('all');
  const [filterAssignee, setFilterAssignee] = useState('all');
  const [filterArchived, setFilterArchived] = useState('all');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [filterHasSource, setFilterHasSource] = useState('all');
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [flowTask, setFlowTask] = useState<TaskRow | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [editTask, setEditTask] = useState<TaskRow | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const loadTasks = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from('tasks').select('*').order('created_at', { ascending: false });
    if (error) { toast.error('خطا در بارگذاری اقدامات'); setLoading(false); return; }

    const rows = await Promise.all((data || []).map(async (t: any) => {
      const { data: wf } = await supabase.from('task_workflow').select('*').eq('task_id', t.id).order('created_at');
      const steps: TaskWorkflowStep[] = (wf || []).map((s: any) => ({
        ...s,
        actor_name: profiles.find(p => p.user_id === s.actor_id)?.full_name || null,
        from_name: profiles.find(p => p.user_id === s.from_user_id)?.full_name || null,
        to_name: profiles.find(p => p.user_id === s.to_user_id)?.full_name || null,
      }));
      return {
        ...t,
        creator_name: profiles.find(p => p.user_id === t.created_by_id)?.full_name || profiles.find(p => p.user_id === t.user_id)?.full_name || null,
        assignee_name: profiles.find(p => p.user_id === t.current_assignee_id)?.full_name || null,
        workflow: steps,
      } as TaskRow;
    }));
    setTasks(rows);
    setLoading(false);
  }, [profiles]);

  const loadGroupTasks = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from('channel_group_tasks').select('*').order('created_at', { ascending: false });
    if (error) { toast.error('خطا در بارگذاری اقدامات گروهی'); setLoading(false); return; }
    const rows = await Promise.all((data || []).map(async (t: any) => {
      const { data: ch } = await supabase.from('channels').select('name').eq('id', t.channel_id).maybeSingle();
      return {
        ...t,
        channel_name: ch?.name || null,
        creator_name: profiles.find(p => p.user_id === t.created_by)?.full_name || null,
      } as GroupTaskRow;
    }));
    setGroupTasks(rows);
    setLoading(false);
  }, [profiles]);

  useEffect(() => {
    if (activeTab === 'tasks') loadTasks();
    else loadGroupTasks();
  }, [activeTab, loadTasks, loadGroupTasks]);

  useEffect(() => {
    if (!menuOpen) return;
    const h = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(null); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [menuOpen]);

  const deleteTask = async (id: string) => {
    await supabase.from('task_workflow').delete().eq('task_id', id);
    const { error } = await supabase.from('tasks').delete().eq('id', id);
    if (error) { toast.error('خطا در حذف'); return; }
    toast.success('اقدام حذف شد');
    setDeleteId(null);
    loadTasks();
  };

  const filtered = tasks.filter(t => {
    if (search && !t.title?.toLowerCase().includes(search.toLowerCase()) && !t.assignee?.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterStatus !== 'all' && t.status !== filterStatus) return false;
    if (filterPriority !== 'all' && t.priority !== filterPriority) return false;
    if (filterUser !== 'all' && t.user_id !== filterUser && t.created_by_id !== filterUser) return false;
    if (filterAssignee !== 'all' && t.current_assignee_id !== filterAssignee) return false;
    if (filterArchived === 'yes' && !t.archived) return false;
    if (filterArchived === 'no' && t.archived) return false;
    if (filterDateFrom) {
      const fromIso = jalaliToGregorian(filterDateFrom);
      if (fromIso && t.created_at && new Date(t.created_at) < new Date(fromIso)) return false;
    }
    if (filterDateTo) {
      const toIso = jalaliToGregorian(filterDateTo);
      if (toIso && t.created_at && new Date(t.created_at) > new Date(toIso)) return false;
    }
    if (filterHasSource === 'yes' && !t.source_message_id) return false;
    if (filterHasSource === 'no' && t.source_message_id) return false;
    return true;
  });

  const clearFilters = () => { setSearch(''); setFilterStatus('all'); setFilterPriority('all'); setFilterUser('all'); setFilterAssignee('all'); setFilterArchived('all'); setFilterDateFrom(''); setFilterDateTo(''); setFilterHasSource('all'); };
  const hasFilter = search || filterStatus !== 'all' || filterPriority !== 'all' || filterUser !== 'all' || filterAssignee !== 'all' || filterArchived !== 'all' || filterDateFrom || filterDateTo || filterHasSource !== 'all';

  const filteredGroupTasks = groupTasks.filter(t =>
    !search || t.title?.toLowerCase().includes(search.toLowerCase()) || t.channel_name?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-4">
        <div className="w-16 h-16 rounded-2xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center shadow-sm flex-shrink-0">
          <CheckSquare className="w-9 h-9 text-amber-600 dark:text-amber-400" />
        </div>
        <div className="flex-1">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">مدیریت اقدامات</h2>
          <p className="text-sm text-gray-500">
            {activeTab === 'tasks' ? `${filtered.length} اقدام از ${tasks.length}` : `${filteredGroupTasks.length} اقدام گروهی از ${groupTasks.length}`}
          </p>
        </div>
        <button onClick={() => activeTab === 'tasks' ? loadTasks() : loadGroupTasks()} className="flex items-center gap-1.5 px-3 py-2 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-xl text-sm text-gray-600 dark:text-gray-300 transition-colors">
          <RefreshCw className="w-4 h-4" /> بارگذاری
        </button>
      </div>

      <div className="flex gap-2">
        <button onClick={() => setActiveTab('tasks')} className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${activeTab === 'tasks' ? 'bg-amber-500 text-white shadow-sm' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'}`}>
          <CheckSquare className="w-4 h-4" /> اقدامات
        </button>
        <button onClick={() => setActiveTab('group')} className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${activeTab === 'group' ? 'bg-amber-500 text-white shadow-sm' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'}`}>
          <Users className="w-4 h-4" /> اقدامات گروهی
        </button>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4">
        <div className="flex items-center gap-2 mb-3"><Filter className="w-4 h-4 text-amber-500" /><span className="text-sm font-semibold text-gray-700 dark:text-gray-300">فیلترهای پیشرفته</span></div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          <div className="relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="جستجو عنوان / مسئول..." className="w-full pr-9 pl-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500" />
          </div>
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className={SEL}>
            <option value="all">همه وضعیت‌ها</option>
            <option value="pending">در انتظار</option>
            <option value="in_progress">در حال انجام</option>
            <option value="completed">تکمیل شده</option>
          </select>
          <select value={filterPriority} onChange={e => setFilterPriority(e.target.value)} className={SEL}>
            <option value="all">همه اولویت‌ها</option>
            <option value="high">بالا</option>
            <option value="medium">متوسط</option>
            <option value="low">پایین</option>
          </select>
          <select value={filterUser} onChange={e => setFilterUser(e.target.value)} className={SEL}>
            <option value="all">همه ایجادکنندگان</option>
            {profiles.map(p => <option key={p.user_id} value={p.user_id}>{p.full_name || p.email}</option>)}
          </select>
          <select value={filterAssignee} onChange={e => setFilterAssignee(e.target.value)} className={SEL}>
            <option value="all">همه مسئولان</option>
            {profiles.map(p => <option key={p.user_id} value={p.user_id}>{p.full_name || p.email}</option>)}
          </select>
          <select value={filterArchived} onChange={e => setFilterArchived(e.target.value)} className={SEL}>
            <option value="all">همه (فعال + بایگانی)</option>
            <option value="no">فقط فعال</option>
            <option value="yes">فقط بایگانی</option>
          </select>
          <select value={filterHasSource} onChange={e => setFilterHasSource(e.target.value)} className={SEL}>
            <option value="all">منشأ: همه</option>
            <option value="yes">از پیام چت</option>
            <option value="no">مستقل</option>
          </select>
          <div className="flex gap-2">
            <div className="flex-1 flex flex-col gap-1">
              <span className="text-xs text-gray-400">از (شمسی)</span>
              <JalaliInput value={filterDateFrom} onChange={setFilterDateFrom} placeholder="1403/01/01" />
            </div>
            <div className="flex-1 flex flex-col gap-1">
              <span className="text-xs text-gray-400">تا (شمسی)</span>
              <JalaliInput value={filterDateTo} onChange={setFilterDateTo} placeholder="1403/12/29" />
            </div>
          </div>
        </div>
        {hasFilter && (
          <button onClick={clearFilters} className="mt-3 flex items-center gap-1.5 text-xs text-red-500 hover:text-red-600">
            <X className="w-3.5 h-3.5" /> پاک کردن فیلترها
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-amber-500" /></div>
      ) : activeTab === 'tasks' ? (
        filtered.length === 0 ? (
          <div className="text-center py-16 text-gray-400"><CheckSquare className="w-12 h-12 mx-auto mb-3 opacity-30" /><p className="text-sm">هیچ اقدامی یافت نشد</p></div>
        ) : (
          <div className="space-y-3">
            {filtered.map(t => (
              <div key={t.id} className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4 hover:shadow-md transition-shadow">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <h4 className="font-bold text-gray-900 dark:text-white text-sm">{t.title}</h4>
                      {t.priority && <Badge2 label={priorityLabel[t.priority] || t.priority} colorCls={priorityColor[t.priority] || 'bg-gray-100 text-gray-500'} />}
                      {t.status && <Badge2 label={statusLabel[t.status] || t.status} colorCls={statusColor[t.status] || 'bg-gray-100 text-gray-500'} />}
                      {t.archived && <Badge2 label="بایگانی" colorCls="bg-gray-100 dark:bg-gray-700 text-gray-500" />}
                      {t.source_message_id && <Badge2 label="از چت" colorCls="bg-teal-100 dark:bg-teal-900/30 text-teal-600 dark:text-teal-400" />}
                      {t.workflow && t.workflow.length > 0 && <Badge2 label={`${t.workflow.length} مرحله`} colorCls="bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400" />}
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-2">
                      <DataField label="شناسه" value={<span className="font-mono text-gray-400 text-xs">{t.id.slice(0, 8)}…</span>} />
                      <DataField label="ایجادکننده" value={t.creator_name} />
                      <DataField label="مسئول فعلی" value={t.assignee_name || t.assignee} />
                      <DataField label="تاریخ ایجاد" value={toJalali(t.created_at)} />
                      <DataField label="موعد انجام" value={toJalali(t.due_date)} />
                      <DataField label="مراحل جریان" value={`${t.workflow?.length || 0} مرحله`} />
                    </div>
                    {t.description && <p className="mt-2 text-xs text-gray-400 bg-gray-50 dark:bg-gray-700/40 rounded-lg px-2.5 py-1.5 line-clamp-2">{t.description}</p>}
                  </div>
                  <div className="relative flex-shrink-0" ref={menuOpen === t.id ? menuRef : undefined}>
                    <button onClick={() => setMenuOpen(menuOpen === t.id ? null : t.id)} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg text-gray-400">
                      <MoreVertical className="w-4 h-4" />
                    </button>
                    {menuOpen === t.id && (
                      <div className="absolute left-0 top-8 z-50 bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-100 dark:border-gray-700 min-w-[140px] overflow-hidden">
                        <button onClick={() => { setEditTask(t); setMenuOpen(null); }} className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">
                          <Edit2 className="w-3.5 h-3.5 text-blue-500" /> ویرایش
                        </button>
                        <button onClick={() => { setFlowTask(t); setMenuOpen(null); }} className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">
                          <GitBranch className="w-3.5 h-3.5 text-amber-500" /> فلوچارت
                        </button>
                        <button onClick={() => { setDeleteId(t.id); setMenuOpen(null); }} className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20">
                          <Trash2 className="w-3.5 h-3.5" /> حذف
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )
      ) : (
        /* Group tasks tab */
        filteredGroupTasks.length === 0 ? (
          <div className="text-center py-16 text-gray-400"><Users className="w-12 h-12 mx-auto mb-3 opacity-30" /><p className="text-sm">هیچ اقدام گروهی یافت نشد</p></div>
        ) : (
          <div className="space-y-3">
            {filteredGroupTasks.map(t => (
              <div key={t.id} className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4 hover:shadow-md transition-shadow">
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <h4 className="font-bold text-gray-900 dark:text-white text-sm">{t.title}</h4>
                  <Badge2 label="گروهی" colorCls="bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400" />
                  {t.status && <Badge2 label={statusLabel[t.status] || t.status} colorCls={statusColor[t.status] || 'bg-gray-100 text-gray-500'} />}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-2">
                  <DataField label="کانال" value={t.channel_name} />
                  <DataField label="ایجادکننده" value={t.creator_name} />
                  <DataField label="تاریخ ایجاد" value={toJalali(t.created_at)} />
                  <DataField label="آخرین بروزرسانی" value={toJalali(t.updated_at)} />
                </div>
                {t.body && <p className="mt-2 text-xs text-gray-400 bg-gray-50 dark:bg-gray-700/40 rounded-lg px-2.5 py-1.5 line-clamp-2">{t.body}</p>}
              </div>
            ))}
          </div>
        )
      )}

      {flowTask && <TaskFlowModal task={flowTask} onClose={() => setFlowTask(null)} />}
      {editTask && <TaskEditModal task={editTask} profiles={profiles} onClose={() => setEditTask(null)} onSaved={loadTasks} />}
      {deleteId && <ConfirmDeleteModal message="آیا از حذف این اقدام اطمینان دارید؟" onConfirm={() => deleteTask(deleteId)} onCancel={() => setDeleteId(null)} />}
    </div>
  );
}

export { TasksMonitor };
