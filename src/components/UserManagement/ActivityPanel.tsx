import { useState, useEffect } from 'react';
import { Activity, Search, Loader as Loader2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import type { AdminProfile, AuditRow } from './types';
import { DetailPanel } from './DetailPanel';

function ActivityPanel({ user, onBack }: { user: AdminProfile; onBack: () => void }) {
  const [logs, setLogs] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    supabase.from('audit_log').select('*').eq('user_id', user.user_id).order('created_at', { ascending: false }).limit(200)
      .then(({ data }) => { setLogs((data || []) as AuditRow[]); setLoading(false); });
  }, [user.user_id]);

  const filtered = logs.filter(l => !search || l.action.includes(search) || (l.module || '').includes(search));

  const sevColor = (s: string) => {
    if (s === 'critical' || s === 'error') return 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400';
    if (s === 'warning') return 'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400';
    return 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400';
  };

  return (
    <DetailPanel title="فعالیت‌های کاربر" icon={Activity} iconColor="text-blue-500" user={user} onBack={onBack}>
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 overflow-hidden">
        <div className="p-4 border-b border-gray-100 dark:border-gray-700 flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="جستجو در فعالیت‌ها..."
              className="w-full pr-9 pl-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <span className="text-xs text-gray-400">{filtered.length} رویداد</span>
        </div>
        {loading && <div className="text-center py-10 text-gray-400 text-sm"><Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />در حال بارگذاری...</div>}
        {!loading && filtered.length === 0 && <div className="text-center py-10 text-gray-400 text-sm">فعالیتی ثبت نشده</div>}
        <div className="divide-y divide-gray-100 dark:divide-gray-700 max-h-[60vh] overflow-y-auto">
          {filtered.map(a => (
            <div key={a.id} className="px-5 py-3.5 hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
              <div className="flex items-center justify-between gap-3 mb-1">
                <span className="text-sm font-medium text-gray-800 dark:text-white">{a.action}</span>
                <span className="text-xs text-gray-400 flex-shrink-0">{new Date(a.created_at).toLocaleString('fa-IR')}</span>
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                {a.module && <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${sevColor(a.severity)}`}>{a.module}</span>}
                {a.ip_address && <span className="text-xs text-gray-400 font-mono">{a.ip_address}</span>}
                {a.details && <span className="text-xs text-gray-400 truncate">{a.details}</span>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </DetailPanel>
  );
}

export { ActivityPanel };
