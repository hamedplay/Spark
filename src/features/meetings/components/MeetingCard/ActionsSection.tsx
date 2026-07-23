import { useState } from 'react';
import { Plus, Loader as Loader2 } from 'lucide-react';
import { supabase } from '../../../../lib/supabase';
import toast from 'react-hot-toast';
import { Action } from '../../../../types';

interface ActionsSectionProps {
  meetingId: string;
  actions: Action[];
  onUpdate: () => void;
}

export function ActionsSection({ meetingId, actions, onUpdate }: ActionsSectionProps) {
  const [loading, setLoading] = useState(false);
  const [newAction, setNewAction] = useState('');
  const [newActionAssignee, setNewActionAssignee] = useState('');

  const handleAddAction = async () => {
    if (!newAction.trim() || !newActionAssignee.trim()) {
      toast.error('لطفاً عنوان و مسئول اقدام را وارد کنید');
      return;
    }
    
    setLoading(true);
    try {
      const { error } = await supabase
        .from('actions')
        .insert([{
          title: newAction,
          meeting_id: meetingId,
          status: 'open',
          assignee: newActionAssignee
        }]);

      if (error) throw error;
      
      toast.success('اقدام جدید با موفقیت اضافه شد');
      setNewAction('');
      setNewActionAssignee('');
      onUpdate();
    } catch (error: any) {
      toast.error('خطا در افزودن اقدام جدید');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateActionStatus = async (actionId: string, newStatus: 'open' | 'closed') => {
    try {
      const { error } = await supabase
        .from('actions')
        .update({ status: newStatus })
        .eq('id', actionId);

      if (error) throw error;
      
      toast.success('وضعیت اقدام با موفقیت به‌روزرسانی شد');
      onUpdate();
    } catch (error: any) {
      toast.error('خطا در به‌روزرسانی وضعیت اقدام');
    }
  };

  return (
    <div className="mt-4 space-y-4">
      <div className="space-y-2">
        <input
          type="text"
          value={newAction}
          onChange={(e) => setNewAction(e.target.value)}
          placeholder="عنوان اقدام جدید..."
          className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white"
        />
        <input
          type="text"
          value={newActionAssignee}
          onChange={(e) => setNewActionAssignee(e.target.value)}
          placeholder="مسئول اقدام"
          className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white"
        />
        <button
          onClick={handleAddAction}
          disabled={loading}
          className="w-full flex items-center justify-center gap-2 bg-blue-500 text-white py-2 rounded-lg hover:bg-blue-600 disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <Plus className="w-5 h-5" />
          )}
          افزودن اقدام
        </button>
      </div>

      {actions.length > 0 && (
        <div className="space-y-2">
          {actions.map((action) => (
            <div key={action.id} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
              <div>
                <p className="font-medium dark:text-white">{action.title}</p>
                <p className="text-sm text-gray-600 dark:text-gray-300">مسئول: {action.assignee}</p>
              </div>
              <select
                value={action.status}
                onChange={(e) => handleUpdateActionStatus(action.id, e.target.value as 'open' | 'closed')}
                className="p-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm dark:bg-gray-700 dark:text-white"
              >
                <option value="open">در حال انجام</option>
                <option value="closed">تکمیل شده</option>
              </select>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}