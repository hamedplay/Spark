import { X } from 'lucide-react';
import { CreateMeetingForm } from '../components/CreateMeetingForm';
import type { CreateMeetingPageProps } from '../types/meetingsPage';

export function CreateMeetingPage(props: CreateMeetingPageProps) {
  const { prefillData, setActivePage, setSparkMeetingPrefill, fetchMeetings } = props;

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => { setActivePage('meetings'); setSparkMeetingPrefill(null); }}
          className="flex items-center gap-2 text-gray-500 dark:text-gray-400 hover:text-blue-500 transition-colors text-sm"
        >
          <X className="w-4 h-4" />
          بازگشت
        </button>
        <h2 className="text-2xl font-bold dark:text-white">ایجاد جلسه جدید</h2>
      </div>
      <CreateMeetingForm
        prefillData={prefillData || undefined}
        onSuccess={() => {
          setActivePage('meetings');
          setSparkMeetingPrefill(null);
          void fetchMeetings();
        }}
      />
    </div>
  );
}
