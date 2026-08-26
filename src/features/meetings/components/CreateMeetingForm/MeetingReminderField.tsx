import { Bell } from 'lucide-react';

export interface MeetingReminderFieldProps {
  minutes: number;
  onMinutesChange: (minutes: number) => void;
}

export function MeetingReminderField({
  minutes,
  onMinutesChange,
}: MeetingReminderFieldProps) {
  return (
    <div className="mt-5">
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
        <div className="flex items-center gap-2"><Bell className="w-4 h-4" /> یادآوری</div>
      </label>
      <select value={minutes} onChange={(e) => onMinutesChange(Number(e.target.value))}
        className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white">
        <option value={0}>بدون یادآوری</option>
        <option value={5}>5 دقیقه قبل</option>
        <option value={10}>10 دقیقه قبل</option>
        <option value={15}>15 دقیقه قبل</option>
        <option value={30}>30 دقیقه قبل</option>
        <option value={60}>1 ساعت قبل</option>
        <option value={1440}>1 روز قبل</option>
      </select>
    </div>
  );
}
