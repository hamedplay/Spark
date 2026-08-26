import { Bot } from 'lucide-react';
import { ChannelCard } from './SocialNotifications/ChannelCard';

export function SocialNotificationsPanel() {
  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
          <Bot className="w-5 h-5 text-blue-500" />
        </div>
        <div>
          <h3 className="font-bold text-gray-800 dark:text-white">اعلان در شبکه‌های اجتماعی</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            ارسال اعلان‌ها و اطلاع‌رسانی از طریق پیام‌رسان‌ها به کاربران و مخاطبین خارج از سازمان
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Telegram */}
        <ChannelCard
          channel="telegram"
          label="تلگرام"
          accentClass="bg-gradient-to-r from-blue-500 to-blue-600"
          icon={
            <svg viewBox="0 0 24 24" className="w-6 h-6 fill-white">
              <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.562 8.248-2.014 9.5c-.148.673-.543.838-1.1.521l-3.05-2.247-1.47 1.415c-.163.163-.3.3-.615.3l.219-3.1 5.64-5.094c.245-.218-.053-.34-.38-.122L7.37 14.38l-3.016-.941c-.655-.205-.668-.655.137-.97l11.765-4.537c.547-.198 1.025.133.847.97l-.541-.654z" />
            </svg>
          }
        />

        {/* Bale */}
        <ChannelCard
          channel="bale"
          label="بله"
          accentClass="bg-gradient-to-r from-teal-500 to-teal-600"
          icon={
            <svg viewBox="0 0 24 24" className="w-6 h-6 fill-white">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z" />
            </svg>
          }
        />
      </div>
    </div>
  );
}
