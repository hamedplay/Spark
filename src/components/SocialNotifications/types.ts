export interface ChannelConfig {
  id?: string;
  channel: string;
  bot_token: string;
  bot_username: string;
  default_chat_id: string;
  is_active: boolean;
  webhook_url: string;
  webhook_secret: string;
  redis_url: string;
  ext_supabase_url: string;
  ext_supabase_service_key: string;
  notes: string;
}

export interface WebhookInfo {
  url: string;
  has_custom_certificate: boolean;
  pending_update_count: number;
  last_error_date?: number;
  last_error_message?: string;
  max_connections?: number;
  ip_address?: string;
}

export const BLANK: Omit<ChannelConfig, 'channel'> = {
  bot_token: '', bot_username: '', default_chat_id: '',
  is_active: false, webhook_url: '', webhook_secret: '',
  redis_url: '', ext_supabase_url: '', ext_supabase_service_key: '',
  notes: '',
};

export const inp = 'w-full px-4 py-2.5 border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition text-sm';
export const inpMono = inp + ' font-mono';
