import { useState, useEffect } from 'react';
import { MapPin, Loader as Loader2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import type { AdminProfile, AuditRow } from './types';
import { DetailPanel } from './DetailPanel';

function UrlsPanel({ user, onBack }: { user: AdminProfile; onBack: () => void }) {
  const [logs, setLogs] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.from('audit_log').select('*').eq('user_id', user.user_id)
      .not('module', 'is', null).order('created_at', { ascending: false }).limit(200)
      .then(({ data }) => { setLogs((data || []) as AuditRow[]); setLoading(false); });
  }, [user.user_id]);

  const moduleMap: Record<string, { count: number; last: string }> = {};
  logs.forEach(l => {
    if (!l.module) return;
    if (!moduleMap[l.module]) moduleMap[l.module] = { count: 0, last: l.created_at };
    moduleMap[l.module].count++;
    if (l.created_at > moduleMap[l.module].last) moduleMap[l.module].last = l.created_at;
  });

  return (
    <DetailPanel title="آدرس‌های مراجعه شده" icon={MapPin} iconColor="text-orange-500" user={user} onBack={onBack}>
      <div className="space-y-4">
        {Object.keys(moduleMap).length > 0 && (
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-5">
            <p className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3">خلاصه بازدیدها</p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {Object.entries(moduleMap).map(([mod, { count, last }]) => (
                <div key={mod} className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-3">
                  <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">{mod}</p>
                  <p className="text-2xl font-bold text-teal-500 mt-1">{count}</p>
                  <p className="text-xs text-gray-400 mt-0.5">آخرین: {new Date(last).toLocaleDateString('fa-IR')}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">جزئیات رویدادها</span>
            <span className="text-xs text-gray-400">{logs.length} رویداد</span>
          </div>
          {loading && <div className="text-center py-8 text-gray-400"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>}
          {!loading && logs.length === 0 && <div className="text-center py-10 text-gray-400 text-sm">رویدادی ثبت نشده</div>}
          <div className="divide-y divide-gray-100 dark:divide-gray-700 max-h-[50vh] overflow-y-auto">
            {logs.slice(0, 50).map(l => (
              <div key={l.id} className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                <MapPin className="w-3.5 h-3.5 text-orange-400 flex-shrink-0" />
                <span className="text-xs font-medium text-gray-500 dark:text-gray-400 w-24 flex-shrink-0 truncate">{l.module}</span>
                <span className="text-xs text-gray-600 dark:text-gray-300 flex-1 truncate">{l.action}</span>
                <span className="text-xs text-gray-300 dark:text-gray-600 flex-shrink-0">{new Date(l.created_at).toLocaleDateString('fa-IR')}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </DetailPanel>
  );
}

export { UrlsPanel };
