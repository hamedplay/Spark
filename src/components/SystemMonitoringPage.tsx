import React, { useState, useEffect } from 'react';
import { CalendarDays, MessageSquare, SquareCheck as CheckSquare, Loader as Loader2 } from 'lucide-react';
import { type Profile } from './SystemMonitoring/types';
import { MeetingsMonitor } from './SystemMonitoring/MeetingsMonitor';
import { ChatMonitor } from './SystemMonitoring/ChatMonitor';
import { TasksMonitor } from './SystemMonitoring/TasksMonitor';
import { supabase } from '../lib/supabase';

type Section = 'meetings' | 'chat' | 'tasks';

const TABS: { key: Section; label: string; icon: React.ElementType; color: string; desc: string }[] = [
  { key: 'meetings', label: 'مدیریت جلسات', icon: CalendarDays, color: 'text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-900/30', desc: 'مشاهده و مدیریت تمام جلسات سیستم' },
  { key: 'chat', label: 'مدیریت چت', icon: MessageSquare, color: 'text-teal-600 dark:text-teal-400 bg-teal-100 dark:bg-teal-900/30', desc: 'مانیتورینگ مکالمات سازمانی' },
  { key: 'tasks', label: 'مدیریت اقدامات', icon: CheckSquare, color: 'text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/30', desc: 'مشاهده و مدیریت تمام اقدامات' },
];

export function SystemMonitoringPage() {
  const [section, setSection] = useState<Section>('meetings');
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [profilesLoaded, setProfilesLoaded] = useState(false);

  useEffect(() => {
    supabase.from('profiles_public').select('user_id, full_name, username').then(({ data }) => {
      setProfiles(data || []);
      setProfilesLoaded(true);
    });
  }, []);

  if (!profilesLoaded) return (
    <div className="flex items-center justify-center py-24"><Loader2 className="w-8 h-8 animate-spin text-blue-500" /></div>
  );

  return (
    <div className="space-y-5" dir="rtl">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {TABS.map(tab => {
          const Icon = tab.icon;
          const active = section === tab.key;
          const borderColor = active ? (tab.key === 'meetings' ? '#3b82f6' : tab.key === 'chat' ? '#14b8a6' : '#f59e0b') : undefined;
          return (
            <button key={tab.key} onClick={() => setSection(tab.key)}
              className={`flex items-center gap-3 p-4 rounded-2xl border-2 transition-all text-right ${active ? 'bg-white dark:bg-gray-800 shadow-md' : 'border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-gray-200 dark:hover:border-gray-600 hover:shadow-sm'}`}
              style={active ? { borderColor } : {}}>
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${tab.color}`}>
                <Icon className="w-6 h-6" />
              </div>
              <div className="min-w-0">
                <p className="font-bold text-gray-900 dark:text-white text-sm">{tab.label}</p>
                <p className="text-xs text-gray-400 dark:text-gray-500 truncate">{tab.desc}</p>
              </div>
            </button>
          );
        })}
      </div>
      {section === 'meetings' && <MeetingsMonitor profiles={profiles} />}
      {section === 'chat' && <ChatMonitor profiles={profiles} />}
      {section === 'tasks' && <TasksMonitor profiles={profiles} />}
    </div>
  );
}
