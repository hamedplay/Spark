export interface RahyabSettings {
  id?: string;
  username: string;
  password: string;
  short_code: string;
  token: string;
  soap_url: string;
  is_active: boolean;
}

export interface InboxMessage {
  id: string;
  row_id: number;
  sender: string;
  receiver: string;
  message: string;
  received_at: string;
  is_read: boolean;
}

export interface DebugLog {
  soapAction: string;
  url: string;
  requestHeaders: Record<string, string>;
  requestBody: string;
  requestTimestamp?: string;
  durationMs?: number;
  responseStatus?: number;
  responseHeaders?: Record<string, string>;
  responseBody?: string;
  parsedResult?: string;
  error?: string;
}

export const BLANK_SETTINGS: RahyabSettings = {
  username: '', password: '', short_code: '', token: '',
  soap_url: 'http://RahvabBulk.ir/WebService/sms.asmx', is_active: false,
};

export const inp = 'w-full px-4 py-2.5 border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition text-sm';

export const TABS = [
  { key: 'settings', label: 'تنظیمات',     icon: 'Settings' },
  { key: 'account',  label: 'حساب کاربری', icon: 'CreditCard' },
  { key: 'send',     label: 'تست ارسال',   icon: 'Send' },
  { key: 'inbox',    label: 'صندوق دریافت', icon: 'Inbox' },
];
