import { useState } from 'react';
import { MessageSquare, Globe, Group as GroupIcon, FileText, FlaskConical, ChartBar as BarChart2, Clock3 } from 'lucide-react';

import { ProvidersTab } from './SmsConfig/ProvidersTab';
import { GroupsTab } from './SmsConfig/GroupsTab';
import { TemplatesTab } from './SmsConfig/TemplatesTab';
import { TestTab } from './SmsConfig/TestTab';
import { ReportsTab } from './SmsConfig/ReportsTab';
import { SmsDeliveryPolicyTab } from './NotificationsConfig/SmsDeliveryPolicyTab';

const TABS = [
  { key: 'providers',  label: 'سرویس‌دهندگان',    icon: Globe },
  { key: 'groups',     label: 'گروه‌بندی پیامک',  icon: GroupIcon },
  { key: 'templates',  label: 'قالب پیام‌ها',     icon: FileText },
  { key: 'test',       label: 'تست سامانه',        icon: FlaskConical },
  { key: 'schedule',   label: 'زمان‌بندی ارسال',   icon: Clock3 },
  { key: 'reports',    label: 'گزارش ارسال',       icon: BarChart2 },
];

export function SmsConfigPanel() {
  const [tab, setTab] = useState<'providers' | 'groups' | 'templates' | 'test' | 'schedule' | 'reports'>('providers');

  return (
    <div className="space-y-4" dir="rtl">
      <h3 className="font-bold text-gray-800 dark:text-white flex items-center gap-2">
        <MessageSquare className="w-5 h-5 text-green-500" />تنظیمات پیامک
      </h3>

      <div className="flex bg-gray-100 dark:bg-gray-700 rounded-xl p-1 gap-1">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => setTab(key as any)}
            className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-colors ${tab === key ? 'bg-white dark:bg-gray-800 text-gray-800 dark:text-white shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}>
            <Icon className="w-4 h-4" />{label}
          </button>
        ))}
      </div>

      {tab === 'providers'  && <ProvidersTab />}
      {tab === 'groups'     && <GroupsTab />}
      {tab === 'templates'  && <TemplatesTab />}
      {tab === 'test'       && <TestTab />}
      {tab === 'schedule'   && <SmsDeliveryPolicyTab />}
      {tab === 'reports'    && <ReportsTab />}
    </div>
  );
}
