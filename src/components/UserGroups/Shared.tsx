import { X, Group as GroupIcon } from 'lucide-react';
import type { UserGroup } from './types';

export function BackHeader({ title, icon: Icon, color, onBack }: { title: string; icon: React.ElementType; color: string; onBack: () => void }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <button onClick={onBack} className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 transition-colors">
        <X className="w-4 h-4" />
      </button>
      <Icon className={`w-5 h-5 ${color}`} />
      <h3 className="font-bold text-gray-800 dark:text-white text-lg">{title}</h3>
    </div>
  );
}

export function GroupBadge({ group }: { group: UserGroup }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4 flex items-center gap-3 mb-4">
      <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center flex-shrink-0">
        <GroupIcon className="w-5 h-5 text-white" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-gray-800 dark:text-white">{group.display_name || group.name}</p>
        <p className="text-xs text-gray-400 font-mono">{group.name}</p>
      </div>
      <div className="flex gap-2 flex-shrink-0">
        {group.is_system && <span className="text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 px-2 py-1 rounded-full">سیستمی</span>}
        {group.is_public && <span className="text-xs bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 px-2 py-1 rounded-full">عمومی</span>}
        <span className="text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 px-2 py-1 rounded-full">{group.member_count ?? 0} عضو</span>
      </div>
    </div>
  );
}
