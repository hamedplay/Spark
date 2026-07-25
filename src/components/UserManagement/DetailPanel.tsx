import React from 'react';
import { X } from 'lucide-react';
import type { AdminProfile } from './types';

function DetailPanel({ title, icon: Icon, iconColor, user, onBack, children }: {
  title: string; icon: React.ElementType; iconColor: string; user: AdminProfile; onBack: () => void; children: React.ReactNode;
}) {
  const initials = (user.full_name || user.email || '?').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 transition-colors">
          <X className="w-4 h-4" />
        </button>
        <Icon className={`w-5 h-5 ${iconColor}`} />
        <h3 className="font-bold text-gray-800 dark:text-white text-lg">{title}</h3>
      </div>
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4 flex items-center gap-3">
        <div className="w-12 h-12 rounded-2xl overflow-hidden bg-teal-100 dark:bg-teal-900/30 flex-shrink-0">
          {user.avatar_url
            ? <img src={user.avatar_url} alt="" className="w-full h-full object-cover" />
            : <div className="w-full h-full flex items-center justify-center font-bold text-teal-600 dark:text-teal-400">{initials}</div>}
        </div>
        <div>
          <p className="font-semibold text-gray-800 dark:text-white">{user.full_name || '—'}</p>
          <p className="text-xs text-gray-400">{user.email}</p>
        </div>
        <div className="mr-auto flex gap-2">
          {user.is_admin && <span className="text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 px-2 py-1 rounded-full">ادمین</span>}
          <span className={`text-xs px-2 py-1 rounded-full ${user.is_active !== false ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' : 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400'}`}>
            {user.is_active !== false ? 'فعال' : 'غیرفعال'}
          </span>
        </div>
      </div>
      {children}
    </div>
  );
}

export { DetailPanel };
