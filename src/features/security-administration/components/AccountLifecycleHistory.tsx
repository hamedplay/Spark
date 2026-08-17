import { useState, useEffect } from 'react';
import { Loader as Loader2, X } from 'lucide-react';
import { loadLifecycleHistory } from '../services/accountLifecycleService';
import { STATUS_LABELS } from '../types/accountLifecycle';
import type { LifecycleUser, LifecycleHistoryEntry } from '../types/accountLifecycle';

interface Props {
  user: LifecycleUser;
  onClose: () => void;
}

export function AccountLifecycleHistory({ user, onClose }: Props) {
  const [history, setHistory] = useState<LifecycleHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        const data = await loadLifecycleHistory(user.user_id);
        setHistory(data);
      } catch {
        setHistory([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [user.user_id]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" dir="rtl">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl max-w-2xl w-full mx-4 max-h-[80vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-gray-100 dark:border-gray-700">
          <h3 className="text-lg font-bold text-gray-800 dark:text-white">
            تاریخچه چرخه عمر — {user.full_name}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-y-auto p-5">
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-6 h-6 text-teal-500 animate-spin" />
            </div>
          ) : history.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">تاریخچه‌ای یافت نشد.</p>
          ) : (
            <div className="space-y-3">
              {history.map(entry => (
                <div key={entry.id} className="border border-gray-100 dark:border-gray-700 rounded-xl p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      {entry.action}
                    </span>
                    <span className="text-xs text-gray-400">
                      {new Date(entry.changed_at).toLocaleString('fa-IR')}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    {STATUS_LABELS[entry.old_status ?? ''] ?? entry.old_status ?? '—'}
                    <span>←</span>
                    <span>{STATUS_LABELS[entry.new_status ?? ''] ?? entry.new_status ?? '—'}</span>
                    {entry.new_version != null && (
                      <span className="text-gray-400">(v{entry.new_version})</span>
                    )}
                  </div>
                  {entry.change_reason && (
                    <p className="text-xs text-gray-500 mt-2">{entry.change_reason}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
