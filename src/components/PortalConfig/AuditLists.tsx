import { useState, useEffect } from 'react';
import { MapPin, LogIn as LoginIcon } from 'lucide-react';
import { supabase } from '../../lib/supabase';

export function LoginHistoryList({ userId }: { userId: string }) {
  const [logs, setLogs] = useState<Array<{ id: string; created_at: string; ip_address: string | null; user_agent: string | null; action: string }>>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    supabase.from('audit_log').select('id,created_at,ip_address,user_agent,action').eq('user_id', userId)
      .ilike('action', '%لاگین%').order('created_at', { ascending: false }).limit(50)
      .then(({ data }) => { setLogs((data || []) as any); setLoading(false); });
  }, [userId]);
  if (loading) return <div className="text-center py-6 text-gray-400 text-sm">در حال بارگذاری...</div>;
  if (logs.length === 0) return (
    <div className="text-center py-8">
      <LoginIcon className="w-8 h-8 text-gray-300 mx-auto mb-2" />
      <p className="text-gray-400 text-sm">تاریخچه ورودی ثبت نشده</p>
      <p className="text-gray-400 text-xs mt-1">ورودهای آینده کاربر اینجا نمایش داده خواهد شد</p>
    </div>
  );
  return (
    <div className="space-y-2 max-h-[50vh] overflow-y-auto">
      {logs.map((l, i) => (
        <div key={l.id} className="flex items-center gap-3 p-3 rounded-xl bg-gray-50 dark:bg-gray-700/50">
          <div className="w-7 h-7 rounded-lg bg-gray-200 dark:bg-gray-600 flex items-center justify-center flex-shrink-0">
            <LoginIcon className="w-3.5 h-3.5 text-gray-500" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-gray-700 dark:text-gray-200">ورود #{i + 1}</span>
              <span className="text-xs text-gray-400">{new Date(l.created_at).toLocaleString('fa-IR')}</span>
            </div>
            <div className="flex gap-3 mt-0.5">
              {l.ip_address && <span className="text-xs text-gray-400 font-mono">{l.ip_address}</span>}
              {l.user_agent && <span className="text-xs text-gray-400 truncate">{l.user_agent.split(' ').slice(0, 2).join(' ')}</span>}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function VisitedUrlsList({ userId }: { userId: string }) {
  const [logs, setLogs] = useState<Array<{ id: string; created_at: string; module: string | null; entity_name: string | null; action: string; ip_address: string | null }>>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    supabase.from('audit_log').select('id,created_at,module,entity_name,action,ip_address').eq('user_id', userId)
      .not('module', 'is', null).order('created_at', { ascending: false }).limit(100)
      .then(({ data }) => { setLogs((data || []) as any); setLoading(false); });
  }, [userId]);

  // Group by module
  const moduleMap: Record<string, number> = {};
  logs.forEach(l => { if (l.module) moduleMap[l.module] = (moduleMap[l.module] || 0) + 1; });

  if (loading) return <div className="text-center py-6 text-gray-400 text-sm">در حال بارگذاری...</div>;
  if (logs.length === 0) return (
    <div className="text-center py-8">
      <MapPin className="w-8 h-8 text-gray-300 mx-auto mb-2" />
      <p className="text-gray-400 text-sm">آدرسی ثبت نشده</p>
    </div>
  );
  return (
    <div className="space-y-3 max-h-[50vh] overflow-y-auto">
      <div className="grid grid-cols-2 gap-2">
        {Object.entries(moduleMap).map(([mod, count]) => (
          <div key={mod} className="flex items-center justify-between p-2.5 rounded-xl bg-gray-50 dark:bg-gray-700/50">
            <span className="text-xs font-medium text-gray-700 dark:text-gray-200 truncate">{mod}</span>
            <span className="text-xs text-blue-500 font-bold mr-2">{count}</span>
          </div>
        ))}
      </div>
      <p className="text-xs text-gray-400 text-center">آخرین ۱۰۰ رویداد</p>
      <div className="space-y-1.5">
        {logs.slice(0, 30).map(l => (
          <div key={l.id} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-700/50 text-xs">
            <MapPin className="w-3 h-3 text-orange-400 flex-shrink-0" />
            <span className="text-gray-500 dark:text-gray-400 font-medium">{l.module}</span>
            <span className="text-gray-400 truncate flex-1">{l.action}</span>
            <span className="text-gray-300 dark:text-gray-600 flex-shrink-0">{new Date(l.created_at).toLocaleDateString('fa-IR')}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
