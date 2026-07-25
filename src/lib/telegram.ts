import { supabase } from './supabase';

interface TelegramResponse {
  success: boolean;
  message?: string;
  data?: any;
}

export const sendMeetingToTelegram = async (meetingId: string, imageData: string): Promise<TelegramResponse> => {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) {
      throw new Error('لطفا ابتدا وارد حساب کاربری خود شوید');
    }

    const res = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/telegram-send-photo`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
          'Apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ meetingId, imageData }),
      },
    );

    const data = await res.json();
    if (!data.ok) {
      throw new Error(data.error || 'خطا در ارسال به تلگرام');
    }

    return {
      success: true,
      message: data.message || 'درخواست با موفقیت به تلگرام ارسال شد',
    };
  } catch (error: any) {
    console.error('Error sending to Telegram:', error);
    return {
      success: false,
      message: error.message || 'خطا در ارسال به تلگرام',
    };
  }
};

export const handleTelegramCallback = async (meetingId: string, action: 'approve' | 'reject'): Promise<TelegramResponse> => {
  try {
    const { error: updateError } = await supabase
      .from('meetings')
      .update({
        status_type: action === 'approve' ? 'approved' : 'requested',
      })
      .eq('id', meetingId);

    if (updateError) throw updateError;

    return {
      success: true,
      message: action === 'approve' ? 'جلسه با موفقیت تایید شد' : 'جلسه رد شد',
    };
  } catch (error) {
    console.error('Error handling Telegram callback:', error);
    return {
      success: false,
      message: 'خطا در پردازش پاسخ تلگرام',
    };
  }
};
