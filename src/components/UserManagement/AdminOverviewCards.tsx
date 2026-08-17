import { useEffect, useState } from 'react';
import {
  Users,
  UserCheck,
  UserX,
  Calendar,
  SquareCheck,
  StickyNote,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';

interface Props {
  totalUsers: number;
  activeUsers: number;
}

interface ContentStats {
  meetings: number | null;
  tasks: number | null;
  notes: number | null;
}

export function AdminOverviewCards({ totalUsers, activeUsers }: Props) {
  const [stats, setStats] = useState<ContentStats>({
    meetings: null,
    tasks: null,
    notes: null,
  });

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const [meetings, tasks, notes] = await Promise.all([
        supabase.from('meetings').select('id', { count: 'exact', head: true }),
        supabase.from('tasks').select('id', { count: 'exact', head: true }),
        supabase.from('notes').select('id', { count: 'exact', head: true }),
      ]);

      if (cancelled) return;

      setStats({
        meetings: meetings.error ? null : (meetings.count ?? 0),
        tasks: tasks.error ? null : (tasks.count ?? 0),
        notes: notes.error ? null : (notes.count ?? 0),
      });
    };

    void load();
    return () => { cancelled = true; };
  }, []);

  const cards = [
    { label: 'کل کاربران', value: totalUsers, icon: Users },
    { label: 'کاربران فعال', value: activeUsers, icon: UserCheck },
    { label: 'کاربران غیرفعال', value: Math.max(0, totalUsers - activeUsers), icon: UserX },
    { label: 'کل جلسات', value: stats.meetings, icon: Calendar },
    { label: 'کل اقدامات', value: stats.tasks, icon: SquareCheck },
    { label: 'کل یادداشت‌ها', value: stats.notes, icon: StickyNote },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3" aria-label="نمای کلی مدیریت">
      {cards.map(({ label, value, icon: Icon }) => (
        <div
          key={label}
          className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{label}</p>
              <p className="mt-1 text-xl font-bold text-gray-800 dark:text-white">
                {value === null ? '—' : value.toLocaleString('fa-IR')}
              </p>
            </div>
            <div className="w-9 h-9 rounded-xl bg-gray-50 dark:bg-gray-700 flex items-center justify-center flex-shrink-0">
              <Icon className="w-4 h-4 text-gray-500 dark:text-gray-300" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
