import { useState } from 'react';
import { GitFork, X } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { insertNotification } from '../../../lib/notifications';
import toast from 'react-hot-toast';
import type { ChannelProfile, MessageWithMeta } from '../types';
import { JalaliDateInput } from './JalaliDateInput';

export function GroupTaskModal({ msg, mentionedUsers, channelId, currentUserId, onClose, onCreated }: {
  msg: MessageWithMeta;
  mentionedUsers: ChannelProfile[];
  channelId: string;
  currentUserId: string | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState(msg.body ? msg.body.slice(0, 80) : '');
  const [groupDueDate, setGroupDueDate] = useState<Date | null>(null);
  const [saving, setSaving] = useState(false);

  const create = async () => {
    if (!title.trim() || !currentUserId || mentionedUsers.length === 0) return;
    if (!groupDueDate) { toast.error('تاریخ سررسید را انتخاب کنید'); return; }
    setSaving(true);
    try {
      const { data: task, error } = await supabase.from('channel_group_tasks').insert({
        channel_id: channelId,
        message_id: msg.id,
        title: title.trim(),
        body: msg.body,
        created_by: currentUserId,
        status: 'open',
        due_date: groupDueDate.toISOString(),
      }).select().maybeSingle();
      if (error || !task) { toast.error('خطا در ایجاد اقدام: ' + error?.message); return; }

      for (const u of mentionedUsers) {
        await supabase.from('channel_group_task_assignments').insert({
          group_task_id: task.id,
          assignee_id: u.user_id,
          status: 'pending',
        });insertNotification({
          userId: u.user_id,
          category: 'channel',
          eventType: 'new_message',
          fallbackTitle: 'اقدام گروهی جدید',
          fallbackMessage: `یک اقدام گروهی برای شما ایجاد شد: ${title.trim()}`,
          placeholders: { message_preview: title.trim() },
          senderId: currentUserId,
        }).catch(() => {});
      }
      toast.success(`اقدام گروهی برای ${mentionedUsers.length} نفر ایجاد شد`);
      onCreated();
      onClose();
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-[400] flex items-center justify-center p-4" dir="rtl">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800 sticky top-0 bg-white dark:bg-gray-900 z-10">
          <div className="flex items-center gap-2">
            <GitFork className="w-5 h-5 text-blue-500" />
            <h3 className="font-bold text-gray-900 dark:text-white">ایجاد اقدام گروهی</h3>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"><X className="w-4 h-4 text-gray-400" /></button>
        </div>
        <div className="p-5 space-y-4">
          {msg.body && (
            <div className="bg-gray-50 dark:bg-gray-800 rounded-xl px-4 py-3 text-xs text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700 line-clamp-3">
              {msg.body}
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">عنوان اقدام</label>
            <input value={title} onChange={e => setTitle(e.target.value)} autoFocus
              placeholder="عنوان اقدام گروهی..."
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-xl dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/40" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">تاریخ سررسید شمسی *</label>
            <JalaliDateInput value={groupDueDate} onChange={setGroupDueDate} />
          </div>
          <div>
            <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">مسئولان ({mentionedUsers.length} نفر)</p>
            <div className="space-y-1.5">
              {mentionedUsers.map(u => (
                <div key={u.user_id} className="flex items-center gap-2 px-3 py-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                  <div className="w-6 h-6 rounded-full bg-blue-500 flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0">
                    {(u.full_name || u.email || 'U').charAt(0).toUpperCase()}
                  </div>
                  <span className="text-sm text-gray-700 dark:text-gray-300">{u.full_name || u.email}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-sm text-gray-600 dark:text-gray-400">لغو</button>
            <button onClick={create} disabled={saving || !title.trim()}
              className="flex-1 py-2.5 rounded-xl bg-blue-500 hover:bg-blue-600 text-white text-sm font-semibold disabled:opacity-50">
              {saving ? 'در حال ایجاد...' : 'ایجاد اقدام'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
