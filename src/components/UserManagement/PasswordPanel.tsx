import { useState } from 'react';
import { KeyRound, Eye, EyeOff, Loader as Loader2, CircleAlert as AlertCircle } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';
import type { AdminProfile } from './types';
import { inp } from './utils';
import { Field } from './Field';
import { DetailPanel } from './DetailPanel';

function PasswordPanel({ user, onBack }: { user: AdminProfile; onBack: () => void }) {
  const [pass, setPass] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (pass.length < 8) { toast.error('رمز عبور باید حداقل ۸ کاراکتر باشد'); return; }
    if (!/(?=.*[a-zA-Z])(?=.*\d)/.test(pass)) { toast.error('رمز عبور باید شامل حروف و عدد باشد'); return; }
    if (pass !== confirm) { toast.error('رمز و تکرار آن یکسان نیست'); return; }

    setSaving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        toast.error('نشست ورود معتبر نیست. لطفاً دوباره وارد شوید.');
        return;
      }

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-users/password`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
            'Apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({ user_id: user.user_id, password: pass }),
        }
      );
      const result = await res.json().catch(() => ({}));
      if (!res.ok || result.error) {
        toast.error(result.error || 'خطا در تغییر رمز');
        return;
      }

      toast.success('رمز عبور با موفقیت تغییر یافت');
      setPass('');
      setConfirm('');
      setShow(false);
      setShowConfirm(false);
      onBack();
    } catch {
      toast.error('خطا در تغییر رمز');
    } finally {
      setSaving(false);
    }
  };

  const passwordInputClass = inp + ' !pr-11 !pl-12 text-left';
  const visibilityButtonClass = 'absolute left-1.5 top-1/2 -translate-y-1/2 z-20 w-9 h-9 flex items-center justify-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500';

  return (
    <DetailPanel title="تغییر رمز عبور" icon={KeyRound} iconColor="text-amber-500" user={user} onBack={onBack}>
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4 sm:p-6 space-y-4 min-w-0">
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl p-3 flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          رمز جدید بلافاصله جایگزین رمز قبلی می‌شود. این عملیات قابل بازگشت نیست.
        </div>

        <Field label="رمز عبور جدید" icon={KeyRound}>
          <div className="relative min-w-0">
            <input
              className={passwordInputClass}
              type={show ? 'text' : 'password'}
              value={pass}
              onChange={e => setPass(e.target.value)}
              placeholder="••••••••"
              dir="ltr"
              data-password-input="true"
              autoComplete="new-password"
            />
            <button
              type="button"
              onClick={() => setShow(v => !v)}
              className={visibilityButtonClass}
              aria-label={show ? 'مخفی کردن رمز عبور جدید' : 'نمایش رمز عبور جدید'}
              aria-pressed={show}
            >
              {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          <p className="mt-1.5 text-xs text-gray-400 dark:text-gray-500">
            حداقل ۸ کاراکتر و شامل حروف و عدد
          </p>
        </Field>

        <Field label="تکرار رمز عبور" icon={KeyRound}>
          <div className="relative min-w-0">
            <input
              className={passwordInputClass}
              type={showConfirm ? 'text' : 'password'}
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              placeholder="••••••••"
              dir="ltr"
              data-password-input="true"
              autoComplete="new-password"
            />
            <button
              type="button"
              onClick={() => setShowConfirm(v => !v)}
              className={visibilityButtonClass}
              aria-label={showConfirm ? 'مخفی کردن تکرار رمز عبور' : 'نمایش تکرار رمز عبور'}
              aria-pressed={showConfirm}
            >
              {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </Field>

        <div className="flex flex-col sm:flex-row gap-3 pt-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-2.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-60 text-white rounded-xl text-sm font-medium transition"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
            {saving ? 'در حال ذخیره...' : 'تغییر رمز'}
          </button>
          <button
            onClick={onBack}
            disabled={saving}
            className="w-full sm:w-auto px-5 py-2.5 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-60 text-gray-700 dark:text-gray-300 rounded-xl text-sm transition"
          >
            انصراف
          </button>
        </div>
      </div>
    </DetailPanel>
  );
}

export { PasswordPanel };
