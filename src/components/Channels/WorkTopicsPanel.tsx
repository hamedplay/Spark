import React, { useState } from 'react';
import { X, GitFork, CheckCircle2, Clock, Archive, User, ChevronDown, ChevronUp, Plus, Send, MessageSquare } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';
import type { GroupTask, GroupTaskAssignment, GroupTaskActivity, ChannelProfile } from './types';

interface Props {
  tasks: GroupTask[];
  members: ChannelProfile[];
  currentUserId: string | null;
  channelId: string;
  allProfiles: ChannelProfile[];
  onClose: () => void;
  onCompleteTask: (taskId: string) => Promise<void>;
  onArchiveTask: (taskId: string) => Promise<void>;
  onUpdateAssignment: (assignmentId: string, status: GroupTaskAssignment['status']) => Promise<void>;
  onAddActivity: (taskId: string, note: string) => Promise<void>;
  onTaskCreated: () => void;
}

const TASK_STATUS_META = {
  open: { label: 'باز', cls: 'text-blue-600 bg-blue-50 dark:bg-blue-900/20 dark:text-blue-400', icon: <Clock className="w-3.5 h-3.5" /> },
  done: { label: 'انجام شد', cls: 'text-green-600 bg-green-50 dark:bg-green-900/20 dark:text-green-400', icon: <CheckCircle2 className="w-3.5 h-3.5" /> },
  archived: { label: 'بایگانی', cls: 'text-gray-500 bg-gray-100 dark:bg-gray-700 dark:text-gray-400', icon: <Archive className="w-3.5 h-3.5" /> },
};

const ASSIGN_STATUS_META = {
  pending: { label: 'در انتظار', cls: 'text-amber-600 bg-amber-50 dark:bg-amber-900/20 border-amber-200' },
  done: { label: 'انجام شد', cls: 'text-green-600 bg-green-50 dark:bg-green-900/20 border-green-200' },
  archived: { label: 'بایگانی', cls: 'text-gray-500 bg-gray-100 dark:bg-gray-700 border-gray-200' },
};

function formatTime(iso: string) {
  return new Date(iso).toLocaleString('fa-IR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function FlowchartView({ task, members, currentUserId, onUpdateAssignment, onAddActivity }: {
  task: GroupTask;
  members: ChannelProfile[];
  currentUserId: string | null;
  onUpdateAssignment: (assignmentId: string, status: GroupTaskAssignment['status']) => Promise<void>;
  onAddActivity: (taskId: string, note: string) => Promise<void>;
}) {
  const assignments = task.assignments || [];
  const activities = task.activities || [];
  const total = assignments.length;
  const doneCount = assignments.filter(a => a.status === 'done' || a.status === 'archived').length;
  const [noteInputs, setNoteInputs] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});

  const submitActivity = async (assigneeId: string) => {
    const note = noteInputs[assigneeId]?.trim();
    if (!note) return;
    setSaving(s => ({ ...s, [assigneeId]: true }));
    try {
      await onAddActivity(task.id, note);
      setNoteInputs(n => ({ ...n, [assigneeId]: '' }));
    } finally {
      setSaving(s => ({ ...s, [assigneeId]: false }));
    }
  };

  return (
    <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700">
      {/* Progress bar */}
      <div className="flex items-center gap-2 mb-4">
        <div className="flex-1 h-2 bg-gray-200 dark:bg-gray-600 rounded-full overflow-hidden">
          <div className="h-full bg-teal-500 rounded-full transition-all" style={{ width: total > 0 ? `${(doneCount / total) * 100}%` : '0%' }} />
        </div>
        <span className="text-[11px] text-gray-500 flex-shrink-0">{doneCount}/{total}</span>
      </div>

      {/* Assignment nodes */}
      <div className="space-y-3">
        {assignments.map((a, i) => {
          const profile = members.find(m => m.user_id === a.assignee_id);
          const name = profile?.full_name || profile?.email || 'کاربر';
          const statusMeta = ASSIGN_STATUS_META[a.status];
          const userActivities = activities.filter(act => act.user_id === a.assignee_id);
          const isMe = a.assignee_id === currentUserId;

          return (
            <div key={a.id} className="flex items-start gap-2">
              {/* Timeline dot + line */}
              <div className="flex flex-col items-center flex-shrink-0 pt-1">
                <div className={`w-3 h-3 rounded-full border-2 flex-shrink-0 ${
                  a.status === 'done' || a.status === 'archived'
                    ? 'bg-teal-500 border-teal-500'
                    : 'bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-500'
                }`} />
                {i < assignments.length - 1 && <div className="w-0.5 flex-1 min-h-[2rem] bg-gray-200 dark:bg-gray-600 mt-1" />}
              </div>

              {/* Assignment block */}
              <div className="flex-1 min-w-0">
                {/* Header row */}
                <div className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg border text-xs ${statusMeta.cls}`}>
                  <div className="flex items-center gap-1.5">
                    <User className="w-3 h-3 flex-shrink-0" />
                    <span className="font-medium">{name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px]">{statusMeta.label}</span>
                    {isMe && a.status === 'pending' && (
                      <button
                        onClick={() => onUpdateAssignment(a.id, 'done')}
                        className="text-[10px] px-2 py-0.5 bg-teal-500 text-white rounded-md hover:bg-teal-600 transition-colors"
                      >
                        تکمیل سهم من
                      </button>
                    )}
                  </div>
                </div>

                {/* Activities for this user */}
                {userActivities.length > 0 && (
                  <div className="mt-1.5 mr-2 space-y-1">
                    {userActivities.map(act => (
                      <div key={act.id} className="flex items-start gap-2 px-2.5 py-1.5 bg-gray-50 dark:bg-gray-700/50 rounded-lg border border-gray-100 dark:border-gray-600">
                        <MessageSquare className="w-3 h-3 text-teal-500 flex-shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <p className="text-[11px] text-gray-700 dark:text-gray-300">{act.note}</p>
                          <span className="text-[10px] text-gray-400">{formatTime(act.created_at)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Activity input — only for assignee (me) */}
                {isMe && (
                  <div className="mt-1.5 mr-2 flex gap-1.5">
                    <input
                      value={noteInputs[a.assignee_id] || ''}
                      onChange={e => setNoteInputs(n => ({ ...n, [a.assignee_id]: e.target.value }))}
                      onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitActivity(a.assignee_id); } }}
                      placeholder="ثبت اقدام..."
                      className="flex-1 text-xs px-2.5 py-1.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg dark:text-white focus:outline-none focus:ring-1 focus:ring-teal-500/40"
                    />
                    <button
                      onClick={() => submitActivity(a.assignee_id)}
                      disabled={!noteInputs[a.assignee_id]?.trim() || saving[a.assignee_id]}
                      className="p-1.5 bg-teal-500 hover:bg-teal-600 disabled:opacity-50 text-white rounded-lg transition-colors flex-shrink-0"
                    >
                      <Send className="w-3 h-3" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TaskCard({ task, members, currentUserId, onComplete, onArchive, onUpdateAssignment, onAddActivity }: {
  task: GroupTask;
  members: ChannelProfile[];
  currentUserId: string | null;
  onComplete: () => Promise<void>;
  onArchive: () => Promise<void>;
  onUpdateAssignment: (assignmentId: string, status: GroupTaskAssignment['status']) => Promise<void>;
  onAddActivity: (taskId: string, note: string) => Promise<void>;
}) {
  const [showFlowchart, setShowFlowchart] = useState(false);
  const [loading, setLoading] = useState(false);
  const isCreator = task.created_by === currentUserId;
  const status = TASK_STATUS_META[task.status];
  const activityCount = (task.activities || []).length;

  const act = async (fn: () => Promise<void>) => {
    setLoading(true);
    try { await fn(); } finally { setLoading(false); }
  };

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
      <div className="p-3.5">
        <div className="flex items-start gap-2 justify-between">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-gray-800 dark:text-white">{task.title}</p>
            {task.body && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-2">{task.body}</p>}
          </div>
          <span className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${status.cls}`}>
            {status.icon} {status.label}
          </span>
        </div>

        <div className="flex items-center gap-2 mt-2.5 flex-wrap">
          {/* Flowchart toggle */}
          <button onClick={() => setShowFlowchart(v => !v)}
            className="flex items-center gap-1 text-xs text-teal-600 dark:text-teal-400 hover:underline">
            <GitFork className="w-3.5 h-3.5" />
            فلوچارت
            {activityCount > 0 && <span className="text-[10px] bg-teal-100 dark:bg-teal-900/40 text-teal-600 dark:text-teal-400 px-1.5 py-0.5 rounded-full">{activityCount}</span>}
            {showFlowchart ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>

          {/* Creator-only actions */}
          {isCreator && task.status === 'open' && (
            <button onClick={() => act(onComplete)} disabled={loading}
              className="flex items-center gap-1 text-xs bg-green-500 hover:bg-green-600 text-white px-2.5 py-1 rounded-lg disabled:opacity-50">
              <CheckCircle2 className="w-3.5 h-3.5" /> تکمیل اقدام
            </button>
          )}
          {isCreator && task.status !== 'archived' && (
            <button onClick={() => act(onArchive)} disabled={loading}
              className="flex items-center gap-1 text-xs bg-gray-400 hover:bg-gray-500 text-white px-2.5 py-1 rounded-lg disabled:opacity-50">
              <Archive className="w-3.5 h-3.5" /> بایگانی
            </button>
          )}
        </div>

        {showFlowchart && (
          <FlowchartView
            task={task}
            members={members}
            currentUserId={currentUserId}
            onUpdateAssignment={onUpdateAssignment}
            onAddActivity={onAddActivity}
          />
        )}
      </div>
    </div>
  );
}

// Inline form to create a new group task directly from the panel
function CreateTaskForm({ channelId, currentUserId, members, onCreated, onCancel }: {
  channelId: string;
  currentUserId: string | null;
  members: ChannelProfile[];
  onCreated: () => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const toggle = (id: string) => setSelectedIds(prev =>
    prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
  );

  const create = async () => {
    if (!title.trim() || !currentUserId || selectedIds.length === 0) return;
    setSaving(true);
    try {
      const { data: task, error } = await supabase.from('channel_group_tasks').insert({
        channel_id: channelId,
        title: title.trim(),
        body: body.trim() || null,
        created_by: currentUserId,
        status: 'open',
      }).select().maybeSingle();
      if (error || !task) { toast.error('خطا: ' + error?.message); return; }

      for (const uid of selectedIds) {
        await supabase.from('channel_group_task_assignments').insert({
          group_task_id: task.id,
          assignee_id: uid,
          status: 'pending',
        });
      }
      toast.success('اقدام گروهی ایجاد شد');
      onCreated();
    } finally { setSaving(false); }
  };

  return (
    <div className="border border-teal-200 dark:border-teal-700 rounded-xl overflow-hidden bg-teal-50/50 dark:bg-teal-900/10">
      <div className="px-4 py-3 border-b border-teal-100 dark:border-teal-800 flex items-center justify-between">
        <span className="text-xs font-semibold text-teal-700 dark:text-teal-400 flex items-center gap-1.5">
          <GitFork className="w-3.5 h-3.5" /> اقدام گروهی جدید
        </span>
        <button onClick={onCancel} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="p-3.5 space-y-3">
        <input
          autoFocus
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="عنوان اقدام..."
          className="w-full text-sm px-3 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500/40"
        />
        <textarea
          value={body}
          onChange={e => setBody(e.target.value)}
          rows={2}
          placeholder="توضیحات (اختیاری)..."
          className="w-full text-xs px-3 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500/40 resize-none"
        />
        <div>
          <p className="text-[11px] font-medium text-gray-500 dark:text-gray-400 mb-1.5">مسئولان (انتخاب کنید)</p>
          <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
            {members.map(m => {
              const selected = selectedIds.includes(m.user_id);
              return (
                <button
                  key={m.user_id}
                  onClick={() => toggle(m.user_id)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs transition-colors ${
                    selected
                      ? 'bg-teal-500 border-teal-500 text-white'
                      : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:border-teal-300'
                  }`}
                >
                  <div className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold flex-shrink-0 ${selected ? 'bg-white/20 text-white' : 'bg-gray-200 dark:bg-gray-600 text-gray-500'}`}>
                    {(m.full_name || m.email || 'U').charAt(0).toUpperCase()}
                  </div>
                  {m.full_name || m.email}
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex gap-2 pt-1">
          <button onClick={onCancel} className="flex-1 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-xs text-gray-500">لغو</button>
          <button
            onClick={create}
            disabled={saving || !title.trim() || selectedIds.length === 0}
            className="flex-1 py-2 rounded-lg bg-teal-500 hover:bg-teal-600 text-white text-xs font-semibold disabled:opacity-50"
          >
            {saving ? 'در حال ایجاد...' : `ایجاد برای ${selectedIds.length || ''} نفر`}
          </button>
        </div>
      </div>
    </div>
  );
}

export function WorkTopicsPanel({ tasks, members, currentUserId, channelId, allProfiles, onClose, onCompleteTask, onArchiveTask, onUpdateAssignment, onAddActivity, onTaskCreated }: Props) {
  const [filterStatus, setFilterStatus] = useState<'all' | 'open' | 'done' | 'archived'>('all');
  const [showCreateForm, setShowCreateForm] = useState(false);

  const filtered = filterStatus === 'all' ? tasks : tasks.filter(t => t.status === filterStatus);

  return (
    <div className="fixed inset-0 bg-black/50 z-[70]" onClick={onClose}>
      <div
        className="absolute inset-y-0 left-0 w-full max-w-lg bg-white dark:bg-gray-900 shadow-2xl flex flex-col"
        style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700 flex-shrink-0">
          <div className="flex items-center gap-3">
            <GitFork className="w-5 h-5 text-teal-500" />
            <h3 className="text-base font-bold dark:text-white">اقدامات گروهی</h3>
            <span className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-500 px-2 py-0.5 rounded-full">{tasks.length}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowCreateForm(v => !v)}
              className={`flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg transition-colors font-medium ${showCreateForm ? 'bg-teal-500 text-white' : 'bg-teal-50 dark:bg-teal-900/20 text-teal-600 dark:text-teal-400 hover:bg-teal-100 dark:hover:bg-teal-900/40'}`}
            >
              <Plus className="w-3.5 h-3.5" /> اقدام جدید
            </button>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500"><X className="w-5 h-5" /></button>
          </div>
        </div>

        <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-700 flex-shrink-0">
          <div className="flex items-center gap-2">
            {(['all', 'open', 'done', 'archived'] as const).map(s => (
              <button key={s} onClick={() => setFilterStatus(s)}
                className={`px-3 py-1 text-xs rounded-lg transition-colors font-medium ${filterStatus === s ? 'bg-teal-500 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'}`}>
                {{ all: 'همه', open: 'باز', done: 'تکمیل', archived: 'بایگانی' }[s]}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {showCreateForm && (
            <CreateTaskForm
              channelId={channelId}
              currentUserId={currentUserId}
              members={members}
              onCreated={() => { onTaskCreated(); setShowCreateForm(false); }}
              onCancel={() => setShowCreateForm(false)}
            />
          )}

          {filtered.length === 0 && !showCreateForm ? (
            <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
              <GitFork className="w-10 h-10 text-gray-300 dark:text-gray-600" />
              <p className="text-sm text-gray-400">اقدام گروهی وجود ندارد</p>
              <p className="text-xs text-gray-400">برای ایجاد اقدام روی «اقدام جدید» کلیک کنید</p>
            </div>
          ) : (
            filtered.map(task => (
              <TaskCard
                key={task.id}
                task={task}
                members={members}
                currentUserId={currentUserId}
                onComplete={() => onCompleteTask(task.id)}
                onArchive={() => onArchiveTask(task.id)}
                onUpdateAssignment={onUpdateAssignment}
                onAddActivity={onAddActivity}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
