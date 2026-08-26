import { useState } from 'react';
import { Trash2, Loader as Loader2, CircleAlert as AlertCircle } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';
import { BackHeader, GroupBadge } from './Shared';
import type { UserGroup } from './types';

export function DeletePanel({ group, onBack, onDone }: { group: UserGroup; onBack: () => void; onDone: () => void }) {
  const [deleting, setDeleting] = useState(false);

  const handle = async () => {
    if (group.is_system) { toast.error('گروه‌های سیستمی قابل حذف نیستند'); return; }
    setDeleting(true);
    await supabase.from('user_group_members').delete().eq('group_id', group.id);
    const { error } = await supabase.from('user_groups').delete().eq('id', group.id);
    if (error) { toast.error('خطا در حذف'); setDeleting(false); return; }
    toast.success('گروه حذف شد');
    onDone();
  };

  return (
    <div className="space-y-4" dir="rtl">
      <BackHeader title="حذف گروه" icon={Trash2} color="text-red-500" onBack={onBack} />
      <GroupBadge group={group} />
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-6">
        {group.is_system ? (
          <div className="flex items-start gap-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl p-4 text-sm text-amber-700 dark:text-amber-400">
            <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            گروه‌های سیستمی قابل حذف نیستند. این گروه برای عملکرد سامانه ضروری است.
          </div>
        ) : (
          <>
            <p className="text-sm text-gray-600 dark:text-gray-300 mb-5">
              آیا مطمئن هستید که می‌خواهید گروه «<strong>{group.display_name || group.name}</strong>» را حذف کنید؟
              تمام اعضای این گروه از آن خارج خواهند شد.
            </p>
            <div className="flex gap-3">
              <button onClick={handle} disabled={deleting}
                className="flex items-center gap-2 px-6 py-2.5 bg-red-500 hover:bg-red-600 disabled:opacity-60 text-white rounded-xl text-sm font-medium transition">
                {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                {deleting ? 'در حال حذف...' : 'حذف گروه'}
              </button>
              <button onClick={onBack} className="px-5 py-2.5 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-xl text-sm transition">انصراف</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
