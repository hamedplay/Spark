import { UserCheck } from 'lucide-react';
import type { MultiSelectValue } from './MultiSelectField';

export interface MeetingManagerFieldProps {
  participants: MultiSelectValue[];
  managerId: string;
  onManagerChange: (userId: string) => void;
}

export function MeetingManagerField({
  participants,
  managerId,
  onManagerChange,
}: MeetingManagerFieldProps) {
  if (participants.length === 0) return null;

  return (
    <div className="mt-5">
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
        <div className="flex items-center gap-2"><UserCheck className="w-4 h-4" /> مدیر جلسه</div>
      </label>
      <select value={managerId} onChange={(e) => onManagerChange(e.target.value)}
        className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white">
        <option value="">بدون مدیر</option>
        {participants.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <p className="text-xs text-gray-400 mt-1">مدیر جلسه می‌تواند تمام تغییرات جلسه را اعمال کند</p>
    </div>
  );
}
