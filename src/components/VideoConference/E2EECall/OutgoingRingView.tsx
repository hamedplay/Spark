import { Loader, PhoneOff } from 'lucide-react';
import type { UserProfile } from './types';

interface Props {
  targetUser: UserProfile | null;
  sessionCode: string;
  onCancel: () => void;
}

export function OutgoingRingView({ targetUser, sessionCode, onCancel }: Props) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-5 bg-gray-900 rounded-2xl">
      <Loader className="w-10 h-10 text-emerald-400 animate-spin" />
      <div className="text-center">
        <p className="text-white text-lg font-semibold">
          در حال تماس با {targetUser?.full_name || targetUser?.email || 'مخاطب'}...
        </p>
        <p className="text-gray-400 text-xs mt-1">در انتظار پاسخ</p>
      </div>
      {sessionCode && (
        <div className="flex items-center gap-2 bg-gray-800 px-4 py-2 rounded-xl">
          <span className="text-gray-300 text-xs">کد جلسه:</span>
          <span className="text-gray-100 text-sm font-mono tracking-widest">{sessionCode}</span>
        </div>
      )}
      <button
        onClick={onCancel}
        className="px-5 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm transition-colors flex items-center gap-2"
      >
        <PhoneOff className="w-4 h-4" /> لغو تماس
      </button>
    </div>
  );
}
