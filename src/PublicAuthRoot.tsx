import { useCallback, useState } from 'react';
import toast, { Toaster } from 'react-hot-toast';
import { AuthPage } from './components/AuthPage';
import { supabase } from './lib/supabase';

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
    toast.success('خوش آمدید! ثبت‌نام شما با موفقیت انجام شد. اکنون با نام کاربری، ایمیل یا شماره موبایل و رمز عبور خود وارد شوید.');
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
