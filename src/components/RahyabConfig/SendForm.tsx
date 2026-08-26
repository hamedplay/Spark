import { CircleCheck as CheckCircle, TriangleAlert as AlertTriangle } from 'lucide-react';
import { inp } from './types';

export function SendForm(props: {
  mobile: string;
  setMobile: (v: string) => void;
  message: string;
  setMessage: (v: string) => void;
  result: { ok: boolean; msg: string } | null;
}) {
  const { mobile, setMobile, message, setMessage, result } = props;

  return (
    <div className="space-y-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-5 space-y-4">
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">شماره موبایل گیرنده</label>
          <input className={inp} value={mobile} onChange={e => setMobile(e.target.value)}
            placeholder="09123456789" dir="ltr" type="tel" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">
            متن پیام
            <span className="text-gray-400 font-normal mr-2">({message.length} کاراکتر)</span>
          </label>
          <textarea className={inp + ' resize-none'} rows={4}
            value={message} onChange={e => setMessage(e.target.value)}
            placeholder="متن پیامک آزمایشی..." />
        </div>
      </div>

      {result && (
        <div className={`flex items-center gap-2 px-4 py-3 rounded-2xl border text-sm ${result.ok ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-700 dark:text-green-300' : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-300'}`}>
          {result.ok ? <CheckCircle className="w-4 h-4 flex-shrink-0" /> : <AlertTriangle className="w-4 h-4 flex-shrink-0" />}
          {result.msg}
        </div>
      )}

      <div className="flex items-start gap-2 px-4 py-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-2xl">
        <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-amber-700 dark:text-amber-300">بین هر دو ارسال متوالی حداقل ۳ ثانیه فاصله توسط وب‌سرویس اعمال می‌شود.</p>
      </div>
    </div>
  );
}
