import React, { useState } from 'react';
import { X, Loader as Loader2, CircleCheck as CheckCircle, ClipboardList } from 'lucide-react';
import { Task } from '../../types';
import { supabase } from '../../lib/supabase';
import { logAudit } from '../../lib/audit';
import toast from 'react-hot-toast';
import { getTaskRecipients, sendTaskNotification } from './utils';

function AddNoteModal({ task, userId, actorName, actorAvatarUrl, onClose, onSaved }: {
  task: Task;
  userId: string;
  actorName: string;
  actorAvatarUrl?: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!note.trim()) { toast.error('یادداشت نمی‌تواند خالی باشد'); return; }
    setSaving(true);
    try {
      await supabase.from('task_workflow_steps').insert({
        task_id: task.id,
        actor_id: userId,
        action: 'note_added',
        note: note.trim(),
      });

      const recipients = getTaskRecipients(task, userId);
      await Promise.all(recipients.map(rid =>
        sendTaskNotification(rid, userId,
          `اقدام جدید روی: ${task.title}`,
          `${actorName} اقدام ثبت کرد: ${note.trim().slice(0, 100)}${note.length > 100 ? '…' : ''}`,
          actorName, actorAvatarUrl, task.title,
          {
            eventType: 'note_added',
            placeholders: { note_excerpt: note.trim().slice(0, 100) },
          }
        )
      ));

      toast.success('اقدام ثبت شد');
      logAudit({ module: 'tasks', action: 'task_action_added', entity_name: task.title, entity_id: task.id, details: `اقدام ثبت شد: ${note.trim().slice(0, 80)}`, severity: 'info' });
      onSaved();
      onClose();
    } catch { toast.error('خطا در ثبت'); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" dir="rtl">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="font-bold dark:text-white flex items-center gap-2">
            <ClipboardList className="w-4 h-4 text-teal-500" /> ثبت اقدام
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-sm text-gray-600 dark:text-gray-400">اقدام انجام شده روی <span className="font-medium text-gray-800 dark:text-white">{task.title}</span> را توضیح دهید:</p>
          <textarea value={note} onChange={e => setNote(e.target.value)}
            rows={4} autoFocus placeholder="توضیح اقدام انجام شده..."
            className="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-xl dark:bg-gray-700 dark:text-white text-sm resize-none" />
          <button onClick={handleSave} disabled={saving}
            className="w-full flex items-center justify-center gap-2 bg-teal-500 hover:bg-teal-600 text-white py-2.5 rounded-xl font-medium transition-colors disabled:opacity-50">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
            ثبت اقدام
          </button>
        </div>
      </div>
    </div>
  );
}

export { AddNoteModal };
