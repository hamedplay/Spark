import React, { useState } from 'react';
import { X, ArrowLeft, Loader as Loader2 } from 'lucide-react';
import { Task } from '../../types';
import { type UserProfile } from './types';
import { type OrgUserProfile } from '../../lib/useOrgUsers';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';
import { UserSelector } from './UserSelector';
import { sendTaskNotification } from './utils';

function ReferModal({ task, users, groups, currentUserId, actorName, actorAvatarUrl, onClose, onReferred }: {
  task: Task;
  users: UserProfile[];
  groups: { label: string; users: OrgUserProfile[] }[];
  currentUserId: string;
  actorName: string;
  actorAvatarUrl?: string | null;
  onClose: () => void;
  onReferred: () => void;
}) {
  const [toUserId, setToUserId] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const handleRefer = async () => {
    if (!toUserId) { toast.error('لطفاً کاربر مقصد را انتخاب کنید'); return; }
    setSaving(true);
    try {
      const toUser = users.find(u => u.user_id === toUserId);
      const toUserName = toUser?.full_name || toUser?.email || '';

      await supabase.from('tasks').update({
        assignee: toUserName || toUserId,
        current_assignee_id: toUserId,
        status: 'pending',
      }).eq('id', task.id);

      await supabase.from('task_workflow_steps').insert({
        task_id: task.id,
        actor_id: currentUserId,
        action: 'referred',
        from_user_id: currentUserId,
        to_user_id: toUserId,
        note,
      });

      await sendTaskNotification(
        toUserId, currentUserId,
        `اقدام به شما ارجاع داده شد: ${task.title}`,
        `${actorName} این اقدام را به شما ارجاع داد${note ? ` — ${note.slice(0, 80)}` : ''}`,
        actorName, actorAvatarUrl, task.title,
        {
          eventType: 'referred',
          placeholders: {
            assignee_name: toUserName || 'کاربر',
            note_excerpt: note.trim(),
          },
        },
      );

      if (task.created_by_id && task.created_by_id !== currentUserId && task.created_by_id !== toUserId) {
        await sendTaskNotification(
          task.created_by_id, currentUserId,
          `ارجاع اقدام: ${task.title}`,
          `${actorName} اقدام را به ${toUserName} ارجاع داد`,
          actorName, actorAvatarUrl, task.title,
          {
            eventType: 'referred',
            placeholders: {
              assignee_name: toUserName || 'کاربر',
              note_excerpt: note.trim(),
            },
          },
        );
      }

      toast.success('اقدام ارجاع داده شد');
      onReferred();
      onClose();
    } catch { toast.error('خطا در ارجاع اقدام'); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" dir="rtl">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="font-bold dark:text-white flex items-center gap-2"><ArrowLeft className="w-4 h-4 text-amber-500" /> ارجاع اقدام</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">ارجاع به</label>
			<UserSelector users={users} groups={groups} value={toUserId} onChange={(id) => setToUserId(id)} placeholder="انتخاب کاربر مقصد" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">توضیح ارجاع (اختیاری)</label>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={3}
              className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white text-sm" />
          </div>
          <button onClick={handleRefer} disabled={saving}
            className="w-full flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-600 text-white py-2.5 rounded-xl font-medium transition-colors disabled:opacity-50">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowLeft className="w-4 h-4" />}
            ارجاع
          </button>
        </div>
      </div>
    </div>
  );
}

export { ReferModal };
