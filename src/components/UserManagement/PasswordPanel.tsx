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
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (pass.length < 6) { toast.error('رمز عبور حداقل ۶ کاراکتر'); return; }
    if (pass !== confirm) { toast.error('رمز و تکرار آن یکسان نیست'); return; }
    setSaving(true);
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
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
    const result = await res.json();
    if (!res.ok || result.error) {
      toast.error(result.error || 'خطا در تغییر رمز');
    } else {
      toast.success('رمز عبور با موفقیت تغییر یافت');
      setPass(''); setConfirm('');
      onBack();
    }
    setSaving(false);
  };

  return (
    <DetailPanel title="تغییر رمز عبور" icon={KeyRound} iconColor="text-amber-500" user={user} onBack={onBack}>
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-6 space-y-4">
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl p-3 flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          رمز جدید بلافاصله جایگزین رمز قبلی می‌شود. این عملیات قابل بازگشت نیست.
        </div>
        <Field label="رمز عبور جدید" icon={KeyRound}>
          <div className="relative">
            <input className={inp + ' pl-10'} type={show ? 'text' : 'password'} value={pass} onChange={e => setPass(e.target.value)} placeholder="حداقل ۶ کاراکتر" dir="ltr" />
            <button type="button" onClick={() => setShow(v => !v)} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
              {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </Field>
        <Field label="تکرار رمز عبور" icon={KeyRound}>
          <input className={inp} type="password" value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="تکرار رمز" dir="ltr" />
        </Field>
        <div className="flex gap-3 pt-2">
          <button onClick={handleSave} disabled={saving}
            className="flex items-center gap-2 px-6 py-2.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-60 text-white rounded-xl text-sm font-medium transition">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
            {saving ? 'در حال ذخیره...' : 'تغییر رمز'}
          </button>
          <button onClick={onBack} className="px-5 py-2.5 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-xl text-sm transition">انصراف</button>
        </div>
      </div>
    </DetailPanel>
  );
}

export { PasswordPanel };
