import React, { useEffect, useState } from 'react';
import { Clock, CheckCircle, XCircle } from 'lucide-react';
import { supabase } from '../../lib/supabase';

export interface PendingApproval {
  id: string;
  room_id: string;
  user_id: string;
  display_name: string;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  expires_at: string;
  approved_by: string | null;
}

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

  useEffect(() => {
    const init = async () => {
      const { data: existing } = await supabase
        .from('pending_approvals')
        .select('id, status, expires_at')
        .eq('room_id', roomId)
        .eq('user_id', userId)
        .eq('status', 'pending')
        .gt('expires_at', new Date().toISOString())
        .maybeSingle();

      if (existing) { setApprovalId(existing.id); return; }

      const { data, error } = await supabase
        .from('pending_approvals')
        .insert({ room_id: roomId, user_id: userId, display_name: displayName })
        .select()
        .single();

      if (!error && data) setApprovalId(data.id);
    };
    init();
  }, [roomId, userId, displayName]);

  useEffect(() => {
    if (!approvalId) return;

    const ch = supabase.channel(`approval-wait-${approvalId}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'pending_approvals',
        filter: `id=eq.${approvalId}`,
      }, ({ new: row }) => {
        if (row.status === 'approved') { setStatus('approved'); setTimeout(onApproved, 1200); }
        if (row.status === 'rejected') setStatus('rejected');
      })
      .subscribe();

    const poll = setInterval(async () => {
      const { data } = await supabase
        .from('pending_approvals')
        .select('status, expires_at')
        .eq('id', approvalId)
        .single();
      if (!data) return;
      if (data.status === 'approved') { setStatus('approved'); setTimeout(onApproved, 1200); }
      if (data.status === 'rejected') setStatus('rejected');
      if (data.status === 'pending' && new Date(data.expires_at) < new Date()) setStatus('expired');
    }, 15000);

    return () => { ch.unsubscribe(); clearInterval(poll); };
  }, [approvalId, onApproved]);

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
            <div className="h-1 bg-gray-800 rounded-full overflow-hidden w-full">
              <div className="h-full bg-teal-500 rounded-full animate-pulse w-3/4" />
            </div>
            <button onClick={onCancel} className="text-gray-500 hover:text-gray-300 text-sm transition-colors">
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
            <button onClick={onCancel} className="w-full py-2.5 bg-gray-700 hover:bg-gray-600 text-white rounded-xl text-sm transition-colors">
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
            <p className="text-gray-400 text-sm mt-1">درخواست پس از ۵ دقیقه منقضی شد. دوباره تلاش کنید.</p>
            <button onClick={onCancel} className="w-full py-2.5 bg-gray-700 hover:bg-gray-600 text-white rounded-xl text-sm transition-colors">
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

  return (
    <div className="p-2 bg-teal-900/20 rounded-xl border border-teal-700/40">
      <p className="text-xs font-semibold text-teal-400 flex items-center gap-1.5 mb-1.5">
        <Clock className="w-3 h-3" />
        در انتظار ورود ({approvals.length})
      </p>
      {approvals.map(a => (
        <div key={a.id} className="flex items-center gap-2 py-1">
          <div className="w-6 h-6 rounded-full bg-teal-700 flex items-center justify-center text-[10px] font-bold flex-shrink-0">
            {a.display_name[0]?.toUpperCase() || '?'}
          </div>
          <span className="text-sm text-gray-200 flex-1 truncate">{a.display_name}</span>
          <button
            onClick={() => onApprove(a.id)}
            title="تأیید ورود"
            className="p-1 rounded-lg bg-green-900/40 hover:bg-green-900/70 text-green-400 transition-colors flex-shrink-0"
          >
            <CheckCircle className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => onReject(a.id)}
            title="رد درخواست"
            className="p-1 rounded-lg bg-red-900/40 hover:bg-red-900/70 text-red-400 transition-colors flex-shrink-0"
          >
            <XCircle className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
