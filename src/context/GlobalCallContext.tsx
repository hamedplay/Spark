import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';
import { AlertTriangle, CheckCircle, X } from 'lucide-react';
import { CallEngine, IncomingCallNotification } from '../components/Chat/CallEngine';
import type { CallSession } from '../components/Chat/CallEngine';
import type { UserProfile } from '../components/Chat/types';
import moment from 'moment-jalaali';

interface ActiveCall {
  session: CallSession;
  otherUser: UserProfile;
  mode: 'caller' | 'callee';
  callType: 'audio' | 'video';
}

interface IncomingCallState {
  session: CallSession;
  callerProfile: UserProfile | null;
}

export interface UrgentAlarmData {
  id: string;
  body?: string | null;
  sender_name: string;
  created_at?: string;
  conversation_id?: string;
}

interface GlobalCallContextValue {
  activeCall: ActiveCall | null;
  incomingCall: IncomingCallState | null;
  startCall: (callType: 'audio' | 'video', otherUser: UserProfile, conversationId: string) => Promise<void>;
  acceptCall: () => void;
  declineCall: () => void;
  endCall: () => void;
  triggerUrgentAlarm: (data: UrgentAlarmData) => void;
}

const GlobalCallContext = createContext<GlobalCallContextValue | null>(null);

export function useGlobalCall() {
  const ctx = useContext(GlobalCallContext);
  if (!ctx) throw new Error('useGlobalCall must be used inside GlobalCallProvider');
  return ctx;
}

function showUrgentMessageToast(
  messageType: string,
  senderName: string,
  body: string,
  onNavigate?: () => void,
) {
  const isUrgent = messageType === 'urgent';

  toast.custom(
    (t) => (
      <div
        onClick={() => {
          toast.dismiss(t.id);
          onNavigate?.();
        }}
        className={`flex items-start gap-3 shadow-2xl rounded-2xl p-3.5 border-2 max-w-sm w-full cursor-pointer transition-all ${
          isUrgent
            ? 'bg-red-50 dark:bg-red-950 border-red-400 dark:border-red-600'
            : 'bg-orange-50 dark:bg-orange-950 border-orange-400 dark:border-orange-600'
        } ${t.visible ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}`}
        dir="rtl"
      >
        <div
          className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
            isUrgent ? 'bg-red-500 animate-pulse' : 'bg-orange-500'
          }`}
        >
          <AlertTriangle className="w-5 h-5 text-white" />
        </div>

        <div className="flex-1 min-w-0">
          <p
            className={`text-sm font-bold leading-tight ${
              isUrgent
                ? 'text-red-700 dark:text-red-300'
                : 'text-orange-700 dark:text-orange-300'
            }`}
          >
            {isUrgent ? 'پیام اورژانسی' : 'پیام مهم'} از {senderName}
          </p>
          <p className="text-xs text-gray-600 dark:text-gray-300 mt-0.5 line-clamp-2 leading-relaxed">
            {body}
          </p>
          {onNavigate && (
            <p className="text-[10px] text-blue-500 dark:text-blue-400 mt-1 font-medium">
              برای رفتن کلیک کنید
            </p>
          )}
        </div>

        <button
          onClick={(e) => {
            e.stopPropagation();
            toast.dismiss(t.id);
          }}
          className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 flex-shrink-0"
        >
          <X size={14} />
        </button>
      </div>
    ),
    { duration: isUrgent ? 15000 : 10000 },
  );

  // Browser notification for urgent messages
  if (
    isUrgent &&
    typeof window !== 'undefined' &&
    'Notification' in window &&
    Notification.permission === 'granted'
  ) {
    const n = new window.Notification(`پیام اورژانسی از ${senderName}`, {
      body,
      icon: '/logo_spark.png',
    });
    n.onclick = () => {
      window.focus();
      onNavigate?.();
      n.close();
    };
  }
}

function playBeep() {
  try {
    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const playTone = (freq: number, start: number, dur: number) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.frequency.setValueAtTime(freq, audioCtx.currentTime + start);
      gain.gain.setValueAtTime(0.5, audioCtx.currentTime + start);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + start + dur);
      osc.start(audioCtx.currentTime + start);
      osc.stop(audioCtx.currentTime + start + dur);
    };
    playTone(1100, 0, 0.15);
    playTone(880, 0.2, 0.15);
    playTone(1100, 0.4, 0.2);
  } catch { /* ignore */ }
}

interface ProviderProps {
  currentUserId: string | null;
  onNavigateToChat?: () => void;
  onNavigateToChannels?: () => void;
  children: React.ReactNode;
}

export function GlobalCallProvider({
  currentUserId,
  onNavigateToChat,
  onNavigateToChannels,
  children,
}: ProviderProps) {
  const [activeCall, setActiveCall] = useState<ActiveCall | null>(null);
  const [incomingCall, setIncomingCall] = useState<IncomingCallState | null>(null);
  const [urgentAlarm, setUrgentAlarm] = useState<UrgentAlarmData | null>(null);
  const [alarmVisible, setAlarmVisible] = useState(false);

  const callChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const urgentChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const alarmIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const firedUrgentIds = useRef<Set<string>>(new Set());

  // Keep navigate callbacks in refs so subscription effects never need to re-run
  const onNavigateToChatRef = useRef(onNavigateToChat);
  onNavigateToChatRef.current = onNavigateToChat;
  const onNavigateToChannelsRef = useRef(onNavigateToChannels);
  onNavigateToChannelsRef.current = onNavigateToChannels;

  // Keep currentUserId in a ref so alarm callbacks don't capture a stale value
  const currentUserIdRef = useRef(currentUserId);
  currentUserIdRef.current = currentUserId;

  const dismissAlarm = () => {
    if (alarmIntervalRef.current) {
      clearInterval(alarmIntervalRef.current);
      alarmIntervalRef.current = null;
    }
    if (urgentAlarm) {
      try {
        const key = `urgent_dismissed_${currentUserIdRef.current}`;
        const existing: string[] = JSON.parse(localStorage.getItem(key) || '[]');
        if (!existing.includes(urgentAlarm.id)) existing.push(urgentAlarm.id);
        localStorage.setItem(key, JSON.stringify(existing.slice(-200)));
      } catch { /* ignore */ }
      if (urgentAlarm.conversation_id) {
        supabase.rpc('mark_conversation_messages_read', {
          p_conversation_id: urgentAlarm.conversation_id,
        }).then(() => {});
      }
    }
    setAlarmVisible(false);
    setUrgentAlarm(null);
  };

  const triggerUrgentAlarm = (data: UrgentAlarmData) => {
    // In-memory dedup: same session
    if (firedUrgentIds.current.has(data.id)) return;

    // Persistent dedup: already dismissed in a previous session
    try {
      const key = `urgent_dismissed_${currentUserIdRef.current}`;
      const dismissed: string[] = JSON.parse(localStorage.getItem(key) || '[]');
      if (dismissed.includes(data.id)) {
        firedUrgentIds.current.add(data.id);
        return;
      }
    } catch { /* ignore */ }

    firedUrgentIds.current.add(data.id);
    setUrgentAlarm(data);
    setAlarmVisible(true);
    playBeep();
    if (alarmIntervalRef.current) clearInterval(alarmIntervalRef.current);
    alarmIntervalRef.current = setInterval(playBeep, 1500);
  };

  // ── Incoming call listener ────────────────────────────────────────────────
  useEffect(() => {
    if (!currentUserId) return;

    callChannelRef.current = supabase
      .channel(`incoming-calls-${currentUserId}`)
      .on('broadcast', { event: 'incoming_call' }, async ({ payload }: any) => {
        if (!payload?.session_id) return;
        const { data: session } = await supabase
          .from('call_sessions')
          .select('*')
          .eq('id', payload.session_id)
          .eq('status', 'ringing')
          .maybeSingle();
        if (!session) return;
        const { data: callerProfile } = await supabase
          .from('profiles')
          .select('user_id, full_name, email, avatar_url')
          .eq('user_id', session.caller_id)
          .maybeSingle();
        setIncomingCall({ session: session as CallSession, callerProfile: callerProfile || null });
      })
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'call_sessions', filter: `callee_id=eq.${currentUserId}` },
        async (payload) => {
          const session = payload.new as CallSession;
          if (session.status !== 'ringing') return;
          setIncomingCall((prev) => (prev ? prev : { session, callerProfile: null }));
          const { data: callerProfile } = await supabase
            .from('profiles')
            .select('user_id, full_name, email, avatar_url')
            .eq('user_id', session.caller_id)
            .maybeSingle();
          setIncomingCall((prev) => {
            if (!prev || prev.session.id !== session.id) return prev;
            return { ...prev, callerProfile: callerProfile || null };
          });
        },
      )
      .subscribe();

    return () => {
      callChannelRef.current?.unsubscribe();
    };
  }, [currentUserId]);

  // ── Global urgent message listener (fires on every page) ─────────────────
  useEffect(() => {
    if (!currentUserId) return;

    urgentChannelRef.current = supabase
      .channel(`urgent-msgs-${currentUserId}`)
      // Direct chat messages
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, async (payload) => {
        const msg = payload.new as any;
        if (!['urgent', 'important'].includes(msg.message_type)) return;
        if (msg.sender_id === currentUserId) return;
        const { data: sender } = await supabase
          .from('profiles')
          .select('full_name')
          .eq('user_id', msg.sender_id)
          .maybeSingle();
        const senderName = sender?.full_name || 'کاربر';
        showUrgentMessageToast(
          msg.message_type,
          senderName,
          msg.body || '',
          () => onNavigateToChatRef.current?.(),
        );
        if (msg.message_type === 'urgent') {
          triggerUrgentAlarm({
            id: msg.id,
            body: msg.body,
            sender_name: senderName,
            created_at: msg.created_at,
            conversation_id: msg.conversation_id,
          });
        }
      })
      // Channel messages
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'channel_messages' }, async (payload) => {
        const msg = payload.new as any;
        if (!['urgent', 'important'].includes(msg.message_type)) return;
        if (msg.sender_id === currentUserId) return;
        const { data: sender } = await supabase
          .from('profiles')
          .select('full_name')
          .eq('user_id', msg.sender_id)
          .maybeSingle();
        const senderName = sender?.full_name || 'کاربر';
        showUrgentMessageToast(
          msg.message_type,
          senderName,
          msg.body || '',
          () => onNavigateToChannelsRef.current?.(),
        );
        if (msg.message_type === 'urgent') {
          triggerUrgentAlarm({
            id: msg.id,
            body: msg.body,
            sender_name: senderName,
            created_at: msg.created_at,
          });
        }
      })
      .subscribe();

    return () => {
      urgentChannelRef.current?.unsubscribe();
    };
  // triggerUrgentAlarm is stable (no deps); currentUserId is the only real dep
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUserId]);

  // ── Call actions ──────────────────────────────────────────────────────────
  const startCall = async (
    callType: 'audio' | 'video',
    otherUser: UserProfile,
    conversationId: string,
  ) => {
    if (!currentUserId) return;
    const { data: session, error } = await supabase
      .from('call_sessions')
      .insert({
        caller_id: currentUserId,
        callee_id: otherUser.user_id,
        call_type: callType,
        status: 'ringing',
        conversation_id: conversationId,
      })
      .select()
      .maybeSingle();
    if (error || !session) return;

    await supabase.channel(`incoming-calls-${otherUser.user_id}`).send({
      type: 'broadcast',
      event: 'incoming_call',
      payload: { session_id: session.id, caller_id: currentUserId },
    });

    setActiveCall({ session: session as CallSession, otherUser, mode: 'caller', callType });
  };

  const acceptCall = () => {
    if (!incomingCall || !currentUserId) return;
    const { session, callerProfile } = incomingCall;
    const otherUser: UserProfile = callerProfile ?? {
      user_id: session.caller_id,
      full_name: null,
      email: null,
    };
    supabase.from('call_sessions').update({ status: 'active' }).eq('id', session.id);
    setIncomingCall(null);
    setActiveCall({ session, otherUser, mode: 'callee', callType: session.call_type });
  };

  const declineCall = () => {
    if (!incomingCall) return;
    supabase.from('call_sessions').update({ status: 'declined' }).eq('id', incomingCall.session.id);
    setIncomingCall(null);
  };

  const endCall = () => setActiveCall(null);

  return (
    <GlobalCallContext.Provider value={{ activeCall, incomingCall, startCall, acceptCall, declineCall, endCall, triggerUrgentAlarm }}>
      {children}

      {/* Global urgent alarm — visible on EVERY page */}
      {alarmVisible && urgentAlarm && (
        <div
          className="fixed inset-0 flex items-center justify-center bg-black/70 backdrop-blur-sm overflow-y-auto"
          style={{ zIndex: 9999, paddingTop: 'env(safe-area-inset-top, 0px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-96 h-96 rounded-full border-4 border-red-500 animate-ping opacity-20" />
          </div>
          <div className="relative bg-white dark:bg-gray-900 rounded-3xl shadow-2xl w-full max-w-md mx-4 overflow-hidden border-4 border-red-500">
            <div className="bg-red-500 px-6 py-5 flex items-center gap-3">
              <AlertTriangle className="w-9 h-9 text-white animate-bounce flex-shrink-0" />
              <div>
                <p className="text-white font-bold text-xl">پیام اورژانسی!</p>
                <p className="text-red-100 text-sm mt-0.5">از طرف: {urgentAlarm.sender_name}</p>
              </div>
            </div>
            <div className="px-6 py-6" dir="rtl">
              <p className="text-gray-800 dark:text-white text-base leading-relaxed whitespace-pre-wrap font-medium">
                {urgentAlarm.body || '📎 فایل'}
              </p>
              {urgentAlarm.created_at && (
                <p className="text-xs text-gray-400 mt-3">
                  {moment(urgentAlarm.created_at).format('HH:mm — jYYYY/jMM/jDD')}
                </p>
              )}
              <p className="text-xs text-red-400 mt-2 text-center animate-pulse">
                برای ادامه کار باید این پیام را تایید کنید
              </p>
            </div>
            <div className="px-6 pb-6">
              <button
                onClick={dismissAlarm}
                className="w-full flex items-center justify-center gap-2 bg-red-500 hover:bg-red-600 active:bg-red-700 text-white font-bold py-3.5 rounded-2xl transition-colors text-base shadow-lg"
              >
                <CheckCircle className="w-5 h-5" /> متوجه شدم — قطع آلارم
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Global incoming call overlay */}
      {incomingCall && (
        <IncomingCallNotification
          session={incomingCall.session}
          callerProfile={incomingCall.callerProfile}
          onAccept={acceptCall}
          onDecline={declineCall}
        />
      )}

      {/* Global call engine */}
      {activeCall && currentUserId && (
        <CallEngine
          currentUserId={currentUserId}
          otherUser={activeCall.otherUser}
          callType={activeCall.callType}
          mode={activeCall.mode}
          session={activeCall.session}
          onEnd={endCall}
        />
      )}
    </GlobalCallContext.Provider>
  );
}
