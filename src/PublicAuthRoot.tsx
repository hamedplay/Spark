import { useCallback, useState } from 'react';
import toast, { Toaster } from 'react-hot-toast';
import { AuthPage } from './components/AuthPage';
import { supabase } from './lib/supabase';

// Login-only presentation/behavior is loaded with this lazy public-auth root
// instead of the application entry bundle. This preserves the existing visual
// cascade while avoiding login observers/styles on authenticated routes.
import './auth-login-v2.css';
import './auth-login-motion.css';
import './auth-placeholder-theme.css';
import './auth-login-unified-tabs.ts';
import './auth-pointer-glow.ts';

interface PublicAuthRootProps {
  onSessionEstablished: () => void;
}

const toasterProps = {
  position: 'top-center' as const,
  containerStyle: { zIndex: 2147483647 },
  toastOptions: { duration: 8000 },
};

export default function PublicAuthRoot({ onSessionEstablished }: PublicAuthRootProps) {
  const [authPageKey, setAuthPageKey] = useState(0);

  const handleAuthSuccess = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();

    if (session) {
      onSessionEstablished();
      return;
    }

    setAuthPageKey(value => value + 1);
    toast.success('ثبت‌نام با موفقیت ثبت شد. اگر تأیید مدیر برای ثبت‌نام فعال باشد، پس از تأیید مدیر امکان ورود خواهید داشت؛ در غیر این صورت اکنون با نام کاربری، ایمیل یا شماره موبایل و رمز عبور خود وارد شوید.');
  }, [onSessionEstablished]);

  return (
    <>
      <Toaster {...toasterProps} />
      <div className="spark-auth-flow min-h-screen">
        <AuthPage key={authPageKey} onSuccess={() => void handleAuthSuccess()} />
      </div>
    </>
  );
}
