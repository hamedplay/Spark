import { Video, MessageSquare, Save } from 'lucide-react';

export function OnlineMeetingSection(props: {
  isOnline: boolean;
  setIsOnline: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  const { isOnline, setIsOnline } = props;
  return (
    <div className={`flex items-center justify-between gap-3 p-3.5 rounded-xl border transition-colors ${isOnline ? 'bg-sky-50 dark:bg-sky-900/20 border-sky-200 dark:border-sky-700' : 'bg-gray-50 dark:bg-gray-700/30 border-gray-200 dark:border-gray-600'}`}>
      <div className="flex items-center gap-3">
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${isOnline ? 'bg-sky-500' : 'bg-gray-300 dark:bg-gray-600'}`}>
          <Video className="w-4 h-4 text-white" />
        </div>
        <div>
          <p className={`text-sm font-medium ${isOnline ? 'text-sky-800 dark:text-sky-200' : 'text-gray-700 dark:text-gray-300'}`}>
            این جلسه به صورت آنلاین برگزار می‌گردد
          </p>
          <p className={`text-xs mt-0.5 ${isOnline ? 'text-sky-600 dark:text-sky-400' : 'text-gray-400 dark:text-gray-500'}`}>
            {isOnline ? 'اتاق ویدیو کنفرانس اتوماتیک ایجاد می‌شود' : 'غیرفعال — جلسه حضوری'}
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={() => setIsOnline(v => !v)}
        className={`relative w-12 h-6 rounded-full transition-colors flex-shrink-0 ${isOnline ? 'bg-sky-500' : 'bg-gray-300 dark:bg-gray-600'}`}
      >
        <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${isOnline ? 'translate-x-6' : 'translate-x-0.5'}`} />
      </button>
    </div>
  );
}

export function SmsOptionsSection(props: {
  sendSms: boolean;
  setSendSms: React.Dispatch<React.SetStateAction<boolean>>;
  saveContact: boolean;
  setSaveContact: React.Dispatch<React.SetStateAction<boolean>>;
  repFromContacts: boolean;
  representative: string;
}) {
  const { sendSms, setSendSms, saveContact, setSaveContact, repFromContacts, representative } = props;
  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={sendSms} onChange={e=>setSendSms(e.target.checked)} className="w-4 h-4 rounded text-blue-600" />
        <span className="text-sm text-gray-700 dark:text-gray-300 flex items-center gap-1.5"><MessageSquare className="w-4 h-4" />ارسال پیامک</span>
      </label>
      {!repFromContacts && representative.trim() && (
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={saveContact} onChange={e=>setSaveContact(e.target.checked)} className="w-4 h-4 rounded text-blue-600" />
          <span className="text-sm text-gray-700 dark:text-gray-300 flex items-center gap-1.5"><Save className="w-4 h-4" />ذخیره اطلاعات تماس در دفترچه</span>
        </label>
      )}
    </div>
  );
}
