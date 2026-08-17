import { Loader as Loader2, Mail, Lock, UserPlus } from 'lucide-react';

export interface MeetingFormAuthFallbackProps {
  isSignUp: boolean;
  email: string;
  password: string;
  loading: boolean;

  onSubmit: (
    event: React.FormEvent<HTMLFormElement>
  ) => void;

  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onToggleMode: () => void;
}

export function MeetingFormAuthFallback({
  isSignUp,
  email,
  password,
  loading,
  onSubmit,
  onEmailChange,
  onPasswordChange,
  onToggleMode,
}: MeetingFormAuthFallbackProps) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
      <div className="text-center">
        <h2 className="text-xl font-bold text-gray-800 dark:text-white mb-6">{isSignUp ? 'ایجاد حساب کاربری' : 'ورود به سیستم'}</h2>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="block text-right text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">ایمیل</label>
            <div className="relative">
              <input type="email" value={email} onChange={(e) => onEmailChange(e.target.value)}
                className="w-full p-2 pl-10 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white" required />
              <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
            </div>
          </div>
          <div>
            <label className="block text-right text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">رمز عبور</label>
            <div className="relative">
              <input type="password" value={password} onChange={(e) => onPasswordChange(e.target.value)}
                className="w-full p-2 pl-10 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white" required minLength={6} />
              <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
            </div>
          </div>
          <button type="submit" disabled={loading}
            className="w-full flex items-center justify-center gap-2 bg-blue-500 text-white py-2 px-4 rounded-lg hover:bg-blue-600 disabled:opacity-50">
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : isSignUp ? <><UserPlus className="w-5 h-5" />ایجاد حساب</> : <><Mail className="w-5 h-5" />ورود</>}
          </button>
        </form>
        <button onClick={onToggleMode} className="mt-4 text-blue-500 hover:text-blue-600">
          {isSignUp ? 'حساب دارید؟ وارد شوید' : 'حساب ندارید؟ ثبت‌نام'}
        </button>
      </div>
    </div>
  );
}
