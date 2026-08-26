import { useState } from 'react';
import { Bell } from 'lucide-react';

import { GroupsTab } from './NotificationsConfig/GroupsTab';
import { TemplatesTab } from './NotificationsConfig/TemplatesTab';
import { LogsTab } from './NotificationsConfig/LogsTab';
import { TABS } from './NotificationsConfig/constants';

export function NotificationsConfigPanel() {
  const [tab, setTab] = useState<'groups' | 'templates' | 'logs'>('groups');

  return (
    <div className="space-y-4" dir="rtl">
      <h3 className="font-bold text-gray-800 dark:text-white flex items-center gap-2">
        <Bell className="w-5 h-5 text-amber-500" />تنظیمات اعلان‌ها
      </h3>

      {/* Tab bar */}
      <div className="flex bg-gray-100 dark:bg-gray-700 rounded-xl p-1 gap-1">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => setTab(key as any)}
            className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-colors ${tab === key ? 'bg-white dark:bg-gray-800 text-gray-800 dark:text-white shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}>
            <Icon className="w-4 h-4" />{label}
          </button>
        ))}
      </div>

      {tab === 'groups'    && <GroupsTab />}
      {tab === 'templates' && <TemplatesTab />}
      {tab === 'logs'      && <LogsTab />}
    </div>
  );
}
