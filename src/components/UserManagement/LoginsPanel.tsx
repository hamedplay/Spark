import { useState, useEffect } from 'react';
import { History, LogIn as LoginIcon, Loader as Loader2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import type { AdminProfile, AuditRow } from './types';
import { DetailPanel } from './DetailPanel';

function LoginsPanel({ user, onBack }: { user: AdminProfile; onBack: () => void }) {
  const [logs, setLogs] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.from('audit_log').select('*').eq('user_id', user.user_id)
      .or('action.ilike.%لاگین%,action.ilike.%ورود%,action.ilike.%login%')
      .order('created_at', { ascending: false }).limit(50)
      .then(({ data }) => { setLogs((data || []) as AuditRow[]); setLoading(false); });
  }, [user.user_id]);

  const parseUA = (ua: string | null) => {
    if (!ua) return '—';
    if (ua.includes('Chrome')) return 'Chrome';
    if (ua.includes('Firefox')) return 'Firefox';
    if (ua.includes('Safari')) return 'Safari';
    if (ua.includes('Edge')) return 'Edge';
    return ua.split('/')[0] || ua;
  };

  return (
    <DetailPanel title="تاریخچه ورودها" icon={History} iconColor="text-gray-500" user={user} onBack={onBack}>
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 overflow-hidden">
        {loading && <div className="text-center py-10 text-gray-400 text-sm"><Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" /></div>}
        {!loading && logs.length === 0 && (
          <div className="text-center py-12">
            <LoginIcon className="w-10 h-10 text-gray-200 dark:text-gray-700 mx-auto mb-3" />
            <p className="text-gray-400 text-sm">سابقه ورودی ثبت نشده</p>
            <p className="text-gray-300 dark:text-gray-600 text-xs mt-1">ورودهای آتی اینجا نمایش داده خواهند شد</p>
          </div>
        )}
        <div className="divide-y divide-gray-100 dark:divide-gray-700 max-h-[60vh] overflow-y-auto">
          {logs.map((l, i) => (
            <div key={l.id} className="flex items-center gap-4 px-5 py-3.5 hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
              <div className="w-8 h-8 rounded-xl bg-gray-100 dark:bg-gray-700 flex items-center justify-center flex-shrink-0 text-xs font-bold text-gray-500">
                {i + 1}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-200">{l.action}</span>
                  <span className="text-xs text-gray-400 flex-shrink-0">{new Date(l.created_at).toLocaleString('fa-IR')}</span>
                </div>
                <div className="flex items-center gap-3 mt-0.5">
                  {l.ip_address && <span className="text-xs text-gray-400 font-mono">{l.ip_address}</span>}
                  <span className="text-xs text-gray-400">{parseUA(l.user_agent)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </DetailPanel>
  );
}

export { LoginsPanel };
