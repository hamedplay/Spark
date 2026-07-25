export interface MeetingMetadataFieldsProps {
  priority: string;
  statusType: string;
  notes: string;

  onPriorityChange: (value: string) => void;
  onStatusTypeChange: (value: string) => void;
  onNotesChange: (value: string) => void;
}

export function MeetingMetadataFields({
  priority,
  statusType,
  notes,
  onPriorityChange,
  onStatusTypeChange,
  onNotesChange,
}: MeetingMetadataFieldsProps) {
  return (
    <>
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">اولویت</label>
        <select value={priority} onChange={(e) => onPriorityChange(e.target.value)}
          className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white">
          <option value="high">بالا</option>
          <option value="medium">متوسط</option>
          <option value="low">پایین</option>
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">وضعیت</label>
        <select value={statusType} onChange={(e) => onStatusTypeChange(e.target.value)}
          className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white">
          <option value="requested">درخواست شده</option>
          <option value="approved">تایید شده</option>
        </select>
      </div>

      <div className="md:col-span-2">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">یادداشت‌ها</label>
        <textarea value={notes} onChange={(e) => onNotesChange(e.target.value)} rows={3}
          className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white" />
      </div>
    </>
  );
}
