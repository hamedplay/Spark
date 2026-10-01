import { Video, MessageSquare, Save } from 'lucide-react';

export function OnlineMeetingSection(props: {
  isOnline: boolean;
  setIsOnline: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  const { isOnline } = props;
  return (
    <div
      className="flex items-center justify-between gap-3 p-3.5 rounded-xl border bg-gray-50 dark:bg-gray-700/30 border-gray-200 dark:border-gray-600 opacity-75"
      aria-disabled="true"
    >
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-gray-300 dark:bg-gray-600">
          <Video className="w-4 h-4 text-white" />
        </div>
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
              این جلسه به صورت آنلاین برگزار می‌گردد
            </p>
            <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
              به‌زودی
            </span>
          </div>
          <p className="text-xs mt-0.5 text-gray-400 dark:text-gray-500">
            {isOnline
              ? 'ویدئوکنفرانس این جلسه قبلاً فعال شده و فعلاً قابل تغییر نیست'
              : 'قابلیت ویدئوکنفرانس موقتاً غیرفعال است'}
          </p>
        </div>
      </div>
      <button
        type="button"
        disabled
        aria-label="ویدئوکنفرانس — به‌زودی"
        className={`relative w-12 h-6 rounded-full flex-shrink-0 cursor-not-allowed ${isOnline ? 'bg-sky-400' : 'bg-gray-300 dark:bg-gray-600'}`}
      >
        <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow ${isOnline ? 'translate-x-6' : 'translate-x-0.5'}`} />
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
