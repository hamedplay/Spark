import { createClient } from '@supabase/supabase-js';
import { Database } from '../types/supabase';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

function getSafeStorage(): Storage | undefined {
  try {
    localStorage.setItem('__test__', '1');
    localStorage.removeItem('__test__');
    return localStorage;
  } catch {
    return undefined;
  }
}

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    storageKey: 'meeting-manager-auth',
    storage: getSafeStorage(),
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'implicit',
    debug: false,
  },
  global: {
    headers: {
      'X-Client-Info': 'meeting-manager'
    }
  },
  db: {
    schema: 'public'
  }
});

// Test Supabase connectivity using the SDK (avoids CORS issues with raw fetch)
export const testSupabaseConnection = async (): Promise<boolean> => {
  try {
    console.log('Testing Supabase connection to:', supabaseUrl);

    // Use the Supabase SDK to check health - this goes through the proper client
    const { error } = await supabase.from('profiles').select('id').limit(1);

    // If we get any response (even "no rows"), the connection works
    // Only a network/auth error means connection failed
    if (error && (error.code === 'PGRST' || error.message?.includes('CORS') || error.message?.includes('Failed to fetch') || error.message?.includes('NetworkError'))) {
      console.error('Supabase connectivity test failed:', error);
      return false;
    }

    console.log('Supabase connection test successful');
    return true;
  } catch (error: any) {
    console.error('Supabase connection test failed:', error.message);
    return false;
  }
};

// Helper function to check if user is authenticated
export const isAuthenticated = async () => {
  try {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error) {
      try { localStorage.removeItem('meeting-manager-auth'); } catch { /* ignore */ }
      await supabase.auth.signOut();
      return false;
    }

    if (!session) {
      return false;
    }

    const { data: { user }, error: refreshError } = await supabase.auth.getUser();
    if (refreshError || !user) {
      try { localStorage.removeItem('meeting-manager-auth'); } catch { /* ignore */ }
      await supabase.auth.signOut();
      return false;
    }

    return true;
  } catch (error) {
    try { localStorage.removeItem('meeting-manager-auth'); } catch { /* ignore */ }
    await supabase.auth.signOut();
    return false;
  }
};

// Helper function to ensure profile exists
export const ensureProfile = async (userId: string, email: string) => {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (error && error.code !== 'PGRST116') {
      throw error;
    }

    if (!data) {
      const defaultProfile = {
        user_id: userId,
        email: email,
        full_name: '',
        phone: '',
        organization: '',
        position: '',
        location: '',
        bio: '',
        avatar_url: '',
        telegram_token: '',
        telegram_chat_id: '',
        webhook_url: '',
        google_calendar_token: null,
        is_admin: false
      };

      // ignoreDuplicates: true means if a profile was already created during
      // registration (with a real full_name), we don't overwrite it with empty values
      const { error: createError } = await supabase
        .from('profiles')
        .upsert([defaultProfile], { onConflict: 'user_id', ignoreDuplicates: true });

      if (createError) throw createError;
    }

    return true;
  } catch (error) {
    console.error('Error ensuring profile:', error);
    return false;
  }
};

// Enhanced error handling middleware with better CORS messaging
export const handleSupabaseError = (error: any) => {
  console.error('Supabase error details:', {
    message: error.message,
    code: error.code,
    status: error.status,
    name: error.name
  });
  
  // Network connectivity and CORS issues
  if (error.message === 'Failed to fetch' || 
      error.name === 'TypeError' && error.message.includes('fetch') ||
      error.code === 'NETWORK_ERROR' ||
      error.name === 'AbortError' ||
      error.message?.includes('CORS') ||
      error.message?.includes('cross-origin')) {
    
    return new Error('خطا در اتصال به سرور. لطفاً تنظیمات CORS در پنل Supabase را بررسی کنید');
  }
  
  // Authentication issues
  if (error.message === 'session_not_found' ||
      error.code === 'refresh_token_not_found' ||
      error.message?.includes('Invalid Refresh Token')) {
    try { localStorage.removeItem('meeting-manager-auth'); } catch { /* ignore */ }
    supabase.auth.signOut();
    return new Error('نشست شما منقضی شده است. لطفاً دوباره وارد شوید');
  }
  
  // Invalid credentials
  if (error.message?.includes('Invalid login credentials')) {
    return new Error('ایمیل یا رمز عبور اشتباه است');
  }
  
  // Email not confirmed
  if (error.message?.includes('Email not confirmed')) {
    return new Error('لطفاً ابتدا ایمیل خود را تایید کنید');
  }
  
  // User already exists
  if (error.message?.includes('already registered') || error.message?.includes('User already registered')) {
    return new Error('این ایمیل قبلاً ثبت شده است');
  }
  
  // Rate limiting
  if (error.message?.includes('rate limit') || error.status === 429) {
    return new Error('تعداد درخواست‌ها بیش از حد مجاز است. لطفاً چند دقیقه صبر کنید');
  }
  
  // Server errors
  if (error.status >= 500) {
    return new Error('خطای سرور. لطفاً چند لحظه صبر کرده و دوباره تلاش کنید');
  }
  
  // Default error
  return error.message ? new Error(error.message) : new Error('خطای نامشخص رخ داده است');
};

// Setup auth state change listener
supabase.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_OUT' || event === 'USER_DELETED') {
    try { localStorage.removeItem('meeting-manager-auth'); } catch { /* ignore */ }
  } else if (event === 'TOKEN_REFRESHED' && !session) {
    supabase.auth.signOut();
  } else if (event === 'SIGNED_IN' && session) {
    (async () => {
      if (session.user) {
        await ensureProfile(session.user.id, session.user.email || '');
      }
    })();
  }
});

// Test connection on module load with better error handling
if (import.meta.env.DEV) {
  testSupabaseConnection().then(success => {
    if (!success) {
      console.warn('⚠️ Supabase connection test failed. Please check your CORS configuration in Supabase dashboard.');
    }
  }).catch(error => {
    console.warn('⚠️ Supabase connection test error:', error.message);
  });
}