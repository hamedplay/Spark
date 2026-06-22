import { supabase } from './supabase';
import toast from 'react-hot-toast';

interface TelegramResponse {
  success: boolean;
  message?: string;
  data?: any;
}

export const sendMeetingToTelegram = async (meetingId: string, imageData: string): Promise<TelegramResponse> => {
  try {
    // دریافت اطلاعات کاربر
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      throw new Error('لطفا ابتدا وارد حساب کاربری خود شوید');
    }

    // دریافت اطلاعات پروفایل کاربر
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('telegram_token, telegram_chat_id')
      .eq('user_id', user.id)
      .single();

    if (profileError || !profile) {
      throw new Error('خطا در دریافت اطلاعات پروفایل');
    }

    if (!profile.telegram_token || !profile.telegram_chat_id) {
      throw new Error('لطفا ابتدا توکن و شناسه چت تلگرام را در پروفایل خود تنظیم کنید');
    }

    // دریافت اطلاعات جلسه
    const { data: meeting, error: meetingError } = await supabase
      .from('meetings')
      .select('subject, priority')
      .eq('id', meetingId)
      .single();

    if (meetingError || !meeting) {
      throw new Error('خطا در دریافت اطلاعات جلسه');
    }

    // تبدیل Data URL به Blob
    const blob = await (await fetch(imageData)).blob();
    const formData = new FormData();
    formData.append('chat_id', profile.telegram_chat_id);
    formData.append('photo', blob, 'meeting.png');
    formData.append('caption', `درخواست جلسه جدید\n\nموضوع: ${meeting.subject}\nاولویت: ${
      meeting.priority === 'high' ? '🔴 بالا' :
      meeting.priority === 'medium' ? '🟡 متوسط' :
      '🟢 پایین'
    }\nشناسه جلسه: ${meetingId}`);
    
    // دکمه‌های تایید/رد و تغییر اولویت
    const replyMarkup = {
      inline_keyboard: [
        [
          { text: '✅ تایید', callback_data: `approve_${meetingId}` },
          { text: '❌ رد', callback_data: `reject_${meetingId}` }
        ],
        [
          { text: '🔴 اولویت بالا', callback_data: `priority_high_${meetingId}` },
          { text: '🟡 اولویت متوسط', callback_data: `priority_medium_${meetingId}` },
          { text: '🟢 اولویت پایین', callback_data: `priority_low_${meetingId}` }
        ]
      ]
    };
    
    formData.append('reply_markup', JSON.stringify(replyMarkup));

    // ارسال به تلگرام
    const response = await fetch(
      `https://api.telegram.org/bot${profile.telegram_token}/sendPhoto`,
      {
        method: 'POST',
        body: formData
      }
    );

    const result = await response.json();
    
    if (!response.ok || !result.ok) {
      throw new Error(result.description || 'خطا در ارسال به تلگرام');
    }

    return {
      success: true,
      message: 'درخواست با موفقیت به تلگرام ارسال شد'
    };
  } catch (error: any) {
    console.error('Error sending to Telegram:', error);
    return {
      success: false,
      message: error.message || 'خطا در ارسال به تلگرام'
    };
  }
};

export const handleTelegramCallback = async (meetingId: string, action: 'approve' | 'reject'): Promise<TelegramResponse> => {
  try {
    const { error: updateError } = await supabase
      .from('meetings')
      .update({ 
        status_type: action === 'approve' ? 'approved' : 'requested' 
      })
      .eq('id', meetingId);

    if (updateError) throw updateError;

    return {
      success: true,
      message: action === 'approve' ? 'جلسه با موفقیت تایید شد' : 'جلسه رد شد'
    };
  } catch (error) {
    console.error('Error handling Telegram callback:', error);
    return {
      success: false,
      message: 'خطا در پردازش پاسخ تلگرام'
    };
  }
};