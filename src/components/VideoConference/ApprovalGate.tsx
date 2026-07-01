import { useEffect, useRef, useState } from 'react';
import { CircleCheck as CheckCircle, Clock, Circle as XCircle } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import type { PendingApproval } from './types';

export type { PendingApproval };

// ── Waiting gate shown to the user seeking approval ───────────────────────────
interface WaitingProps {
  roomId: string;
  userId: string;
  displayName: string;
  onApproved: () => void;
  onRejected: () => void;
  onCancel: () => void;
}

export function ApprovalWaitingGate({ roomId, userId, displayName, onApproved, onRejected, onCancel }: WaitingProps) {
  const [status, setStatus] = useState<'pending' | 'approved' | 'rejected' | 'expired'>('pending');
  const [approvalId, setApprovalId] = useState<string | null>(null);
  // Seconds remaining until expiry (null = not yet known)
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  // Keep callbacks in refs so they never cause the subscription effect to re-run
  const onApprovedRef = useRef(onApproved);
  const onRejectedRef = useRef(onRejected);
  onApprovedRef.current = onApproved;
  onRejectedRef.current = onRejected;

  // Guard: fire onApproved / onRejected at most once
  const firedRef = useRef(false);

  const fireApproved = () => {
    if (firedRef.current) return;
    firedRef.current = true;
    setStatus('approved');
    const t = setTimeout(() => onApprovedRef.current(), 1200);
    return t;
  };

  const fireRejected = () => {
    if (firedRef.current) return;
    firedRef.current = true;
    setStatus('rejected');
    onRejectedRef.current();
  };

  // ── Create or reuse pending approval record ──────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      const { data: existing } = await supabase
        .from('pending_approvals')
        .select('id, status, expires_at')
        .eq('room_id', roomId)
        .eq('user_id', userId)
        .eq('status', 'pending')
        .gt('expires_at', new Date().toISOString())
        .maybeSingle();

      if (cancelled) return;

      if (existing) {
        setApprovalId(existing.id);
        const secs = Math.round((new Date(existing.expires_at).getTime() - Date.now()) / 1000);
        setSecondsLeft(Math.max(0, secs));
        return;
      }

      const { data, error } = await supabase
        .from('pending_approvals')
        .insert({ room_id: roomId, user_id: userId, display_name: displayName })
        .select()
        .single();

      if (!error && data && !cancelled) {
        setApprovalId(data.id);
        const secs = Math.round((new Date(data.expires_at).getTime() - Date.now()) / 1000);
        setSecondsLeft(Math.max(0, secs));
      }
    };
    init();
    return () => { cancelled = true; };
  }, [roomId, userId, displayName]);

  // ── Realtime + poll subscription ─────────────────────────────────────────────
  useEffect(() => {
    if (!approvalId) return;

    let approvedTimer: ReturnType<typeof setTimeout> | undefined;

    const handleRow = (row: Partial<PendingApproval>) => {
      if (row.status === 'approved') { approvedTimer = fireApproved() ?? undefined; }
      if (row.status === 'rejected') { fireRejected(); }
    };

    const ch = supabase.channel(`approval-wait-${approvalId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'pending_approvals',
        filter: `id=eq.${approvalId}`,
      }, ({ new: row, eventType }) => {
        if (eventType === 'DELETE') {
          // Record removed (room closed / admin purge) — treat as cancelled
          if (!firedRef.current) setStatus('expired');
          return;
        }
        handleRow(row as Partial<PendingApproval>);
      })
      .subscribe();

    // Fallback poll every 12 s
    const poll = setInterval(async () => {
      const { data } = await supabase
        .from('pending_approvals')
        .select('status, expires_at')
        .eq('id', approvalId)
        .maybeSingle();
      if (!data) return;
      if (data.status !== 'pending') { handleRow(data); return; }
      const left = Math.round((new Date(data.expires_at).getTime() - Date.now()) / 1000);
      if (left <= 0 && !firedRef.current) setStatus('expired');
    }, 12000);

    // Countdown ticker
    const ticker = setInterval(() => {
      setSecondsLeft(prev => {
        if (prev === null || prev <= 0) return 0;
        return prev - 1;
      });
    }, 1000);

    return () => {
      ch.unsubscribe();
      clearInterval(poll);
      clearInterval(ticker);
      if (approvedTimer !== undefined) clearTimeout(approvedTimer);
    };
  // Only re-run when the approvalId changes, not the callbacks
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [approvalId]);

  const formatSecs = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${String(sec).padStart(2, '0')}`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950 p-4" dir="rtl">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl p-8 w-full max-w-sm text-center space-y-5 shadow-2xl">
        {status === 'pending' && (
          <>
            <div className="w-16 h-16 rounded-full bg-teal-900/40 flex items-center justify-center mx-auto">
              <Clock className="w-8 h-8 text-teal-400 animate-pulse" />
            </div>
            <div>
              <h2 className="text-white font-bold text-xl mb-1">در انتظار تأیید</h2>
              <p className="text-gray-400 text-sm">درخواست ورود ارسال شد. منتظر تأیید میزبان باشید…</p>
            </div>
            {/* Countdown progress bar */}
            {secondsLeft !== null && (
              <div className="space-y-1">
                <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden w-full">
                  <div
                    className={`h-full rounded-full transition-all duration-1000 ${secondsLeft < 60 ? 'bg-amber-400' : 'bg-teal-500'}`}
                    style={{ width: `${Math.min((secondsLeft / 300) * 100, 100)}%` }}
                  />
                </div>
                <p className="text-xs text-gray-500">
                  {secondsLeft > 0 ? `${formatSecs(secondsLeft)} تا انقضا` : 'در حال انقضا…'}
                </p>
              </div>
            )}
            <button
              onClick={onCancel}
              aria-label="انصراف از درخواست ورود"
              className="text-gray-500 hover:text-gray-300 text-sm transition-colors"
            >
              انصراف
            </button>
          </>
        )}

        {status === 'approved' && (
          <>
            <div className="w-16 h-16 rounded-full bg-green-900/40 flex items-center justify-center mx-auto">
              <CheckCircle className="w-8 h-8 text-green-400" />
            </div>
            <h2 className="text-white font-bold text-xl">تأیید شد!</h2>
            <p className="text-gray-400 text-sm">در حال ورود به جلسه…</p>
          </>
        )}

        {status === 'rejected' && (
          <>
            <div className="w-16 h-16 rounded-full bg-red-900/40 flex items-center justify-center mx-auto">
              <XCircle className="w-8 h-8 text-red-400" />
            </div>
            <h2 className="text-white font-bold text-xl">رد شد</h2>
            <p className="text-gray-400 text-sm mt-1">میزبان درخواست شما را رد کرد.</p>
            <button
              onClick={onCancel}
              aria-label="بازگشت به صفحه قبل"
              className="w-full py-2.5 bg-gray-700 hover:bg-gray-600 text-white rounded-xl text-sm transition-colors"
            >
              بازگشت
            </button>
          </>
        )}

        {status === 'expired' && (
          <>
            <div className="w-16 h-16 rounded-full bg-amber-900/40 flex items-center justify-center mx-auto">
              <Clock className="w-8 h-8 text-amber-400" />
            </div>
            <h2 className="text-white font-bold text-xl">منقضی شد</h2>
            <p className="text-gray-400 text-sm mt-1">درخواست منقضی شد. دوباره تلاش کنید.</p>
            <button
              onClick={onCancel}
              aria-label="بازگشت و تلاش مجدد"
              className="w-full py-2.5 bg-gray-700 hover:bg-gray-600 text-white rounded-xl text-sm transition-colors"
            >
              بازگشت
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ── Pending approvals list shown in host's participants panel ─────────────────
interface HostPanelProps {
  approvals: PendingApproval[];
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}

export function PendingApprovalsList({ approvals, onApprove, onReject }: HostPanelProps) {
  if (!approvals.length) return null;

  const approveAll = () => approvals.forEach(a => onApprove(a.id));
  const rejectAll = () => approvals.forEach(a => onReject(a.id));

  return (
    <div className="p-2 bg-teal-900/20 rounded-xl border border-teal-700/40" role="list" aria-label="درخواست‌های در انتظار ورود">
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-xs font-semibold text-teal-400 flex items-center gap-1.5">
          <Clock className="w-3 h-3" aria-hidden="true" />
          در انتظار ورود ({approvals.length})
        </p>
        {approvals.length > 1 && (
          <div className="flex gap-1">
            <button
              onClick={approveAll}
              aria-label="تأیید همه درخواست‌ها"
              title="تأیید همه"
              className="text-[10px] px-2 py-0.5 rounded-lg bg-green-900/40 hover:bg-green-900/70 text-green-400 transition-colors"
            >
              همه را تأیید کن
            </button>
            <button
              onClick={rejectAll}
              aria-label="رد همه درخواست‌ها"
              title="رد همه"
              className="text-[10px] px-2 py-0.5 rounded-lg bg-red-900/40 hover:bg-red-900/70 text-red-400 transition-colors"
            >
              همه را رد کن
            </button>
          </div>
        )}
      </div>
      {approvals.map(a => (
        <div key={a.id} role="listitem" className="flex items-center gap-2 py-1">
          <div className="w-6 h-6 rounded-full bg-teal-700 flex items-center justify-center text-[10px] font-bold flex-shrink-0" aria-hidden="true">
            {(a.display_name[0] || '?').toUpperCase()}
          </div>
          <span className="text-sm text-gray-200 flex-1 truncate">{a.display_name}</span>
          <button
            onClick={() => onApprove(a.id)}
            aria-label={`تأیید ورود ${a.display_name}`}
            title="تأیید ورود"
            className="p-1 rounded-lg bg-green-900/40 hover:bg-green-900/70 text-green-400 transition-colors flex-shrink-0"
          >
            <CheckCircle className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
          <button
            onClick={() => onReject(a.id)}
            aria-label={`رد درخواست ${a.display_name}`}
            title="رد درخواست"
            className="p-1 rounded-lg bg-red-900/40 hover:bg-red-900/70 text-red-400 transition-colors flex-shrink-0"
          >
            <XCircle className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}
