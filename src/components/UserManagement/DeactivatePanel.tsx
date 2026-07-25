import { useState } from 'react';
import { UserX, UserCheck, Loader as Loader2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';
import type { AdminProfile } from './types';
import { DetailPanel } from './DetailPanel';

function DeactivatePanel({ user, onBack, onDone }: { user: AdminProfile; onBack: () => void; onDone: () => void }) {
  const isActive = user.is_active !== false;
  const [saving, setSaving] = useState(false);

  const handle = async () => {
    setSaving(true);
    const { error } = await supabase.from('profiles').update({ is_active: !isActive }).eq('user_id', user.user_id);
    if (error) { toast.error('خطا'); setSaving(false); return; }
    toast.success(isActive ? 'کاربر غیرفعال شد' : 'کاربر فعال شد');
    onDone();
  };

  return (
    <DetailPanel title={isActive ? 'غیرفعال کردن کاربر' : 'فعال کردن کاربر'} icon={isActive ? UserX : UserCheck} iconColor={isActive ? 'text-red-500' : 'text-green-500'} user={user} onBack={onBack}>
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-6">
        <p className="text-sm text-gray-600 dark:text-gray-300 mb-6">
          {isActive
            ? `با غیرفعال کردن "${user.full_name || user.email}" دسترسی آن‌ها به سامانه مسدود می‌شود. اطلاعات حذف نمی‌شود.`
            : `با فعال کردن "${user.full_name || user.email}" دسترسی آن‌ها به سامانه بازگردانده می‌شود.`}
        </p>
        <div className="flex gap-3">
          <button onClick={handle} disabled={saving}
            className={`flex items-center gap-2 px-6 py-2.5 text-white rounded-xl text-sm font-medium transition disabled:opacity-60 ${isActive ? 'bg-red-500 hover:bg-red-600' : 'bg-green-500 hover:bg-green-600'}`}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : isActive ? <UserX className="w-4 h-4" /> : <UserCheck className="w-4 h-4" />}
            {saving ? 'در حال انجام...' : isActive ? 'غیرفعال کن' : 'فعال کن'}
          </button>
          <button onClick={onBack} className="px-5 py-2.5 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-xl text-sm transition">انصراف</button>
        </div>
      </div>
    </DetailPanel>
  );
}

export { DeactivatePanel };
