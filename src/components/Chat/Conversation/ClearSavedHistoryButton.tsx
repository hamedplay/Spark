import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Trash2, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../../../lib/supabase';
import { useModalFocus } from '../../../app/layout/hooks/useModalFocus';

export function ClearSavedHistoryButton({ conversationId, onCleared }: { conversationId: string; onCleared: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  useModalFocus(open, dialog, () => { if (!busy) setOpen(false); });
  const clear = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { error } = await supabase.rpc('clear_chat_for_user', { p_conversation_id: conversationId });
      if (error) throw error;
      onCleared(); setOpen(false); toast.success('تاریخچه پیام‌های ذخیره‌شده پاک شد');
    } catch { toast.error('پاک کردن تاریخچه انجام نشد؛ دوباره تلاش کنید.'); }
    finally { setBusy(false); }
  };
  return <>
    <button type="button" title="پاک کردن تاریخچه پیام‌های ذخیره‌شده" aria-label="پاک کردن تاریخچه پیام‌های ذخیره‌شده" onClick={() => setOpen(true)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-red-100 bg-red-50 text-red-600 transition hover:bg-red-100 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300"><Trash2 className="h-3.5 w-3.5" /></button>
    {open && createPortal(<div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/50 p-4" dir="rtl" onClick={event => { if (event.target === event.currentTarget && !busy) setOpen(false); }}>
      <div ref={dialog} tabIndex={-1} role="alertdialog" aria-modal="true" aria-labelledby="clear-saved-title" aria-describedby="clear-saved-description" className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl dark:bg-slate-900">
        <h3 id="clear-saved-title" className="font-bold text-slate-900 dark:text-white">پاک کردن تاریخچه</h3>
        <p id="clear-saved-description" className="mt-3 text-sm leading-7 text-slate-600 dark:text-slate-300">تمام پیام‌های فعلیِ ذخیره‌شده از تاریخچه شما پاک می‌شوند. این کار قابل بازگشت نیست. ادامه می‌دهید؟</p>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" disabled={busy} onClick={() => setOpen(false)} className="rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-300">انصراف</button>
          <button type="button" disabled={busy} onClick={() => void clear()} className="flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2 text-sm text-white disabled:opacity-50">{busy && <Loader2 className="h-4 w-4 animate-spin" />}پاک کردن تاریخچه</button>
        </div>
      </div>
    </div>, document.body)}
  </>;
}
