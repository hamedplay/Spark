import { Phone, PhoneOff } from 'lucide-react';
import type { IncomingCall } from './types';

interface Props {
  incomingCall: IncomingCall;
  onAccept: () => void;
  onReject: () => void;
}

export function IncomingRingView({ incomingCall, onAccept, onReject }: Props) {
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="flex flex-col items-center justify-center py-16 gap-6"
    >
      <div className="w-24 h-24 rounded-full bg-emerald-900/30 flex items-center justify-center animate-pulse">
        <Phone aria-hidden="true" className="w-12 h-12 text-emerald-400" />
      </div>
      <div className="text-center">
        <p className="text-white text-xl font-bold">{incomingCall.callerName}</p>
        <p className="text-gray-400 text-sm mt-1">تماس با قابلیت رمزنگاری سرتاسری</p>
        <p className="text-gray-500 text-xs mt-1">
          پس از اتصال، Safety Number را برای اطمینان از عدم MITM بررسی کنید.
        </p>
      </div>
      <div className="flex gap-5">
        <button
          onClick={onReject}
          aria-label="رد کردن تماس"
          className="w-16 h-16 rounded-full bg-red-600 hover:bg-red-700 flex items-center justify-center shadow-lg transition-colors"
        >
          <PhoneOff aria-hidden="true" className="w-7 h-7 text-white" />
        </button>
        <button
          onClick={onAccept}
          aria-label="پاسخ دادن به تماس"
          className="w-16 h-16 rounded-full bg-emerald-600 hover:bg-emerald-700 flex items-center justify-center shadow-lg transition-colors"
        >
          <Phone aria-hidden="true" className="w-7 h-7 text-white" />
        </button>
      </div>
    </div>
  );
}
