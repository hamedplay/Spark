import { useState, useEffect } from 'react';
import { Phone, Video, PhoneIncoming, PhoneMissed, PhoneOutgoing, Clock, Search, User, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import moment from 'moment-jalaali';
import type { UserProfile } from './types';
import type { CallSession } from './CallEngine';

interface CallRecord extends CallSession {
  otherUser: UserProfile | null;
}

interface Props {
  currentUserId: string;
  onStartCall: (otherUser: UserProfile, callType: 'audio' | 'video') => void;
  onClose?: () => void;
}

export function CallHistoryPage({ currentUserId, onStartCall, onClose }: Props) {
  const [records, setRecords] = useState<CallRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<'all' | 'missed'>('all');

  useEffect(() => { fetchHistory(); }, [currentUserId]);

  const fetchHistory = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('call_sessions')
      .select('*')
      .or(`caller_id.eq.${currentUserId},callee_id.eq.${currentUserId}`)
      .in('status', ['ended', 'declined', 'missed'])
      .order('created_at', { ascending: false })
      .limit(100);

    if (!data) { setLoading(false); return; }

    const otherIds = data.map(r => r.caller_id === currentUserId ? r.callee_id : r.caller_id);
    const { data: profiles } = await supabase
      .from('profiles')
      .select('user_id, full_name, email')
      .in('user_id', [...new Set(otherIds)]);

    const profileMap = new Map((profiles || []).map((p: any) => [p.user_id, p]));
    setRecords(data.map((r: any) => ({
      ...r,
      caller_candidates: r.caller_candidates || [],
      callee_candidates: r.callee_candidates || [],
      otherUser: profileMap.get(r.caller_id === currentUserId ? r.callee_id : r.caller_id) || null,
    })));
    setLoading(false);
  };

  const filtered = records.filter(r => {
    const name = r.otherUser?.full_name || r.otherUser?.email || '';
    if (search && !name.toLowerCase().includes(search.toLowerCase())) return false;
    if (tab === 'missed') return r.status === 'missed' || (r.status === 'declined' && r.callee_id === currentUserId);
    return true;
  });

  const getCallIcon = (r: CallRecord) => {
    const isCaller = r.caller_id === currentUserId;
    if (r.status === 'missed' || (r.status === 'declined' && !isCaller)) {
      return <PhoneMissed className="w-4 h-4 text-red-400" />;
    }
    if (isCaller) return <PhoneOutgoing className="w-4 h-4 text-teal-400" />;
    return <PhoneIncoming className="w-4 h-4 text-blue-400" />;
  };

  const getCallLabel = (r: CallRecord) => {
    const isCaller = r.caller_id === currentUserId;
    if (r.status === 'missed' || (r.status === 'declined' && !isCaller)) return 'از دست رفته';
    if (isCaller) return 'تماس خروجی';
    return 'تماس ورودی';
  };

  const formatDuration = (s: number) => {
    if (!s || s === 0) return '';
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return m > 0 ? `${m} دقیقه ${sec} ثانیه` : `${sec} ثانیه`;
  };

  const otherName = (r: CallRecord) => r.otherUser?.full_name || r.otherUser?.email || 'کاربر';

  return (
    <div className="flex flex-col h-full" dir="rtl">
      {/* Header */}
      <div className="px-4 pt-4 pb-3 border-b border-gray-100 dark:border-gray-700 shrink-0">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-bold text-gray-900 dark:text-white">تماس‌ها</h2>
          {onClose && (
            <button
              onClick={onClose}
              className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              title="بستن"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Search */}
        <div className="relative mb-3">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="جستجوی مخاطب..."
            className="w-full pr-9 pl-3 py-2 text-sm bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl outline-hidden focus:ring-2 focus:ring-teal-400 dark:text-white placeholder-gray-400"
          />
        </div>

        {/* Tabs */}
        <div className="flex bg-gray-100 dark:bg-gray-800 rounded-xl p-1 gap-1">
          {[{ key: 'all', label: 'همه' }, { key: 'missed', label: 'از دست رفته' }].map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key as any)}
              className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition-all ${tab === t.key ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-xs' : 'text-gray-500 dark:text-gray-400'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-40 text-gray-400 text-sm">در حال بارگذاری...</div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-gray-400 gap-2">
            <Phone className="w-10 h-10 opacity-30" />
            <p className="text-sm">تماسی یافت نشد</p>
          </div>
        ) : (
          filtered.map(r => (
            <div
              key={r.id}
              className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors border-b border-gray-50 dark:border-gray-800"
            >
              {/* Avatar */}
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-teal-400 to-teal-600 flex items-center justify-center text-white font-bold text-sm shrink-0">
                {otherName(r)[0]?.toUpperCase() || <User className="w-5 h-5" />}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  {getCallIcon(r)}
                  <span className="font-medium text-sm text-gray-900 dark:text-white truncate">{otherName(r)}</span>
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className={`text-xs ${(r.status === 'missed' || (r.status === 'declined' && r.callee_id === currentUserId)) ? 'text-red-400' : 'text-gray-400 dark:text-gray-500'}`}>
                    {getCallLabel(r)}
                  </span>
                  {r.duration_seconds > 0 && (
                    <span className="text-xs text-gray-400 flex items-center gap-1">
                      <Clock className="w-3 h-3" />{formatDuration(r.duration_seconds)}
                    </span>
                  )}
                  <span className="text-xs text-gray-300 dark:text-gray-600">
                    {moment(r.created_at).format('HH:mm jDD/jMM')}
                  </span>
                </div>
              </div>

              {/* Call back buttons */}
              {r.otherUser && (
                <div className="flex gap-1.5 shrink-0">
                  <button
                    onClick={() => onStartCall(r.otherUser!, 'audio')}
                    className="w-9 h-9 rounded-full bg-teal-50 dark:bg-teal-900/20 hover:bg-teal-100 dark:hover:bg-teal-900/40 flex items-center justify-center text-teal-600 dark:text-teal-400 transition-colors"
                    title="تماس صوتی"
                  >
                    <Phone className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => onStartCall(r.otherUser!, 'video')}
                    className="w-9 h-9 rounded-full bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/40 flex items-center justify-center text-blue-600 dark:text-blue-400 transition-colors"
                    title="تماس تصویری"
                  >
                    <Video className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
