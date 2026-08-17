import { CirclePlus as PlusCircle, Loader as Loader2, Save } from 'lucide-react';

export interface MeetingFormActionsProps {
  showSaveContact: boolean;
  saveContact: boolean;
  loading: boolean;
  submitLabel: string;

  onSaveContactChange: (checked: boolean) => void;
  children?: React.ReactNode;
}

export function MeetingFormActions({
  showSaveContact,
  saveContact,
  loading,
  submitLabel,
  onSaveContactChange,
  children,
}: MeetingFormActionsProps) {
  return (
    <>
      {showSaveContact && (
        <div className="mt-4 flex items-center gap-2">
          <input type="checkbox" id="saveContact" checked={saveContact} onChange={(e) => onSaveContactChange(e.target.checked)} className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500" />
          <label htmlFor="saveContact" className="text-sm text-gray-700 dark:text-gray-300 flex items-center gap-2">
            <Save className="w-4 h-4" /> ذخیره اطلاعات تماس در دفترچه
          </label>
        </div>
      )}

      <div className="mt-6 flex gap-3">
        <button type="submit" disabled={loading}
          className="flex-1 flex items-center justify-center gap-2 bg-blue-500 text-white py-2.5 px-4 rounded-lg hover:bg-blue-600 disabled:opacity-50 font-medium">
          {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <PlusCircle className="w-5 h-5" />}
          {submitLabel}
        </button>
        {children}
      </div>
    </>
  );
}
