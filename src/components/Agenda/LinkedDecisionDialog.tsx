import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';

interface DecisionDetails {
  id: string; title: string; description: string | null;
  minute_title: string; minute_date: string; minute_number: string | null;
  decision_number: string | null; clause_order: number | null;
  owner_name: string; status: string; progress_percent: number;
  updates: Array<{ created_at: string; event_type: string; update_text: string | null; new_status: string }>;
}

export function LinkedDecisionDialog({ decisionId, agendaResultId, onClose }: {
  decisionId: string; agendaResultId?: string; onClose: () => void;
}) {
  const [decision, setDecision] = useState<DecisionDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [report, setReport] = useState('');
  const [saving, setSaving] = useState(false);
  const reload = async () => {
    const { data, error: loadError } = await (supabase as any).rpc('get_linked_agenda_decision_v1', { p_decision_id: decisionId });
    if (loadError) throw loadError;
    return data as DecisionDetails;
  };
  useEffect(() => {
    let alive = true;
    setLoading(true); setError('');
    void reload().then(data => { if (alive) setDecision(data); })
      .catch(() => { if (alive) setError('مجوز مشاهده مصوبه وجود ندارد یا اطلاعات آن قابل دسترسی نیست.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [decisionId]);
  const saveFollowup = async () => {
    if (!agendaResultId || report.trim().length < 3 || saving) return;
    setSaving(true); setError('');
    try {
      const { error: saveError } = await (supabase as any).rpc('record_linked_agenda_followup_v1', {
        p_agenda_result_id: agendaResultId, p_report_text: report.trim(),
      });
      if (saveError) throw saveError;
      setDecision(await reload());
      setReport('');
    } catch {
      setError('ثبت نتیجه ناموفق بود. این عملیات فقط پس از انتشار صورت‌جلسه جدید و با مجوز ثبت پیگیری مصوبه اصلی امکان‌پذیر است.');
    } finally { setSaving(false); }
  };
  return createPortal(
    <div className="fixed inset-0 z-[10020] flex items-center justify-center bg-black/50 p-3" dir="rtl" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-label="جزئیات مصوبه مرتبط" className="flex max-h-[90dvh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-gray-900">
        <header className="flex shrink-0 items-center justify-between border-b p-4 dark:border-gray-700">
          <h3 className="text-base font-bold">مصوبه اصلی و تاریخچه پیگیری</h3>
          <button type="button" aria-label="بستن" onClick={onClose}><X className="h-5 w-5" /></button>
        </header>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 text-sm">
          {loading && <Loader2 className="h-5 w-5 animate-spin" />}
          {error && <p className="rounded-lg bg-red-50 p-2 text-red-600" role="alert">{error}</p>}
          {decision && <>
            <p className="break-words font-bold">{decision.title}</p>
            <p className="text-gray-500">{decision.minute_number ? `صورت‌جلسه شماره ${decision.minute_number}` : decision.minute_title} · {decision.minute_date} · {decision.decision_number ? `مصوبه ${decision.decision_number}` : 'شماره مصوبه ثبت نشده'} {decision.clause_order ? `· بند ${decision.clause_order}` : ''}</p>
            {decision.description && <p className="whitespace-pre-wrap break-words">{decision.description}</p>}
            <p>مسئول: {decision.owner_name || '—'} · وضعیت: {decision.status} · پیشرفت: {decision.progress_percent}٪</p>
            <h4 className="font-semibold">سوابق پیگیری ({decision.updates.length} مورد اخیر)</h4>
            {decision.updates.length===0 && <p className="text-gray-500">سابقه‌ای ثبت نشده است.</p>}
            {decision.updates.map((entry, index) => <div key={index} className="rounded-lg border p-2 dark:border-gray-700">
              <p className="text-xs text-gray-500">{entry.created_at ? new Date(entry.created_at).toLocaleString('fa-IR') : '—'} · {entry.event_type}</p>
              <p className="whitespace-pre-wrap break-words">{entry.update_text || 'تغییر وضعیت: ' + entry.new_status}</p>
            </div>)}
            {agendaResultId && <div className="space-y-2 border-t pt-3 dark:border-gray-700">
              <label className="block font-semibold">ثبت نتیجه بررسی در تاریخچه مصوبه اصلی</label>
              <textarea value={report} onChange={e => setReport(e.target.value)} maxLength={4000} rows={3} placeholder="شرح نتیجه جلسه جدید (حداقل ۳ نویسه)" className="w-full rounded-lg border p-2 dark:border-gray-700 dark:bg-gray-800" />
              <button type="button" onClick={() => void saveFollowup()} disabled={saving || report.trim().length<3}
                className="rounded-lg bg-blue-600 px-3 py-2 text-white disabled:opacity-40">{saving ? 'در حال ثبت…' : 'ثبت نتیجه در مصوبه اصلی'}</button>
              <p className="text-xs text-gray-500">فقط بعد از انتشار صورت‌جلسه جدید و با مجوز پیگیری مصوبه اصلی قابل ثبت است؛ وضعیت مصوبه خودکار تغییر نمی‌کند.</p>
            </div>}
          </>}
        </div>
      </section>
    </div>, document.body,
  );
}
