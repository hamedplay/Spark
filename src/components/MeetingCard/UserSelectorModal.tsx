import { useState, useEffect } from 'react';
import { Building2, Send, X, Loader as Loader2, Search, ChevronDown, ChevronRight, Users } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';
import { Meeting } from '../../types';
import { useOrgUsers, OrgUnitGroup } from '../../lib/useOrgUsers';

interface UserSelectorModalProps {
  meetingId: string;
  onClose: () => void;
  onSuccess: () => void;
}

export function UserSelectorModal({ meetingId, onClose, onSuccess }: UserSelectorModalProps) {
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [meetingDetails, setMeetingDetails] = useState<Partial<Meeting> | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedUnitId, setSelectedUnitId] = useState<string>('all');
  const [expandedUnits, setExpandedUnits] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [sendingToUserId, setSendingToUserId] = useState<string | null>(null);

  const { groups, allUsers, loading: loadingUsers } = useOrgUsers(currentUserId);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) setCurrentUserId(user.id);
    })();
    fetchMeetingDetails();
  }, []);

  const fetchMeetingDetails = async () => {
    const { data } = await supabase
      .from('meetings')
      .select('subject, request_date, duration, location, representative, phone, notes, priority')
      .eq('id', meetingId)
      .single();
    if (data) setMeetingDetails(data);
  };

  const handleSendToUser = async (userId: string, userName: string) => {
    try {
      setLoading(true);
      setSendingToUserId(userId);

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { toast.error('لطفا ابتدا وارد شوید'); return; }

      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name, position')
        .eq('user_id', user.id)
        .maybeSingle();

      const senderName = profile?.full_name || user.email || 'کاربر';
      const senderPosition = profile?.position || '';

      let meetingData = meetingDetails;
      if (!meetingData) {
        const { data } = await supabase.from('meetings')
          .select('subject, request_date, duration, location, representative, phone, notes, priority')
          .eq('id', meetingId).single();
        if (data) { meetingData = data; setMeetingDetails(data); }
      }

      if (!meetingData) { toast.error('اطلاعات جلسه در دسترس نیست'); return; }

      const { error } = await supabase.from('shared_meetings').insert([{
        meeting_id: meetingId,
        sender_id: user.id,
        sender_name: senderName + (senderPosition ? ` (${senderPosition})` : ''),
        recipient_id: userId,
        status: 'pending',
        meeting_data: meetingData,
      }]);
      if (error) throw error;

      await supabase.from('notifications').insert([{
        user_id: userId,
        title: 'درخواست جلسه جدید',
        message: `یک درخواست جلسه جدید از طرف ${senderName} برای شما ارسال شده است`,
        type: 'meeting',
      }]);

      toast.success(`درخواست جلسه برای ${userName} ارسال شد`);
      onSuccess();
    } catch {
      toast.error('خطا در ارسال جلسه');
    } finally {
      setLoading(false);
      setSendingToUserId(null);
    }
  };

  const toggleUnit = (key: string) => {
    setExpandedUnits(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const isSearching = searchTerm.trim().length > 0;

  const filteredAll = isSearching
    ? allUsers.filter(u =>
        (u.full_name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (u.email || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (u.unit_name || '').toLowerCase().includes(searchTerm.toLowerCase())
      )
    : [];

  const visibleGroups: OrgUnitGroup[] = selectedUnitId === 'all'
    ? groups
    : groups.filter(g => (g.unit_id || '__no_unit__') === selectedUnitId);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" dir="rtl">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md mx-4 flex flex-col max-h-[88vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700 shrink-0">
          <h3 className="text-base font-bold text-gray-900 dark:text-white">ارسال جلسه به کاربران</h3>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* فیلترها */}
        <div className="px-4 pt-3 pb-2 shrink-0 space-y-2">
          {/* فیلتر واحد سازمانی */}
          <div className="flex gap-2">
            <select
              value={selectedUnitId}
              onChange={e => setSelectedUnitId(e.target.value)}
              className="flex-1 p-2 text-sm border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">همه واحدهای سازمانی</option>
              {groups.map(g => (
                <option key={g.unit_id || '__no_unit__'} value={g.unit_id || '__no_unit__'}>
                  {g.unit_name} ({g.users.length} نفر)
                </option>
              ))}
            </select>
          </div>
          {/* جستجو */}
          <div className="relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              placeholder="جستجوی نام، ایمیل یا واحد..."
              className="w-full pr-9 pl-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* لیست کاربران */}
        <div className="flex-1 overflow-y-auto px-2 pb-3">
          {loadingUsers ? (
            <div className="flex justify-center py-10">
              <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
            </div>
          ) : isSearching ? (
            // نتایج جستجو — بدون گروه‌بندی
            <div className="space-y-1.5 px-2 pt-2">
              {filteredAll.length === 0 ? (
                <p className="text-center text-sm text-gray-400 py-6">کاربری یافت نشد</p>
              ) : filteredAll.map(u => (
                <UserRow
                  key={u.user_id}
                  userId={u.user_id}
                  name={u.full_name || u.email || ''}
                  email={u.email || ''}
                  subtitle={u.unit_name || u.position_title || ''}
                  sending={sendingToUserId === u.user_id}
                  disabled={loading}
                  onSend={handleSendToUser}
                />
              ))}
            </div>
          ) : visibleGroups.length === 0 ? (
            <p className="text-center text-sm text-gray-400 py-8">کاربری یافت نشد</p>
          ) : (
            <div className="pt-2 space-y-2">
              {visibleGroups.map(group => {
                const key = group.unit_id || '__no_unit__';
                const isOpen = expandedUnits.has(key);
                return (
                  <div key={key} className="rounded-xl overflow-hidden border border-gray-100 dark:border-gray-700">
                    <button
                      onClick={() => toggleUnit(key)}
                      className="w-full flex items-center gap-2 px-3 py-2.5 bg-gray-50 dark:bg-gray-700/60 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-right"
                    >
                      {isOpen ? <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" /> : <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />}
                      {group.unit_id ? (
                        <Building2 className="w-4 h-4 text-blue-500 shrink-0" />
                      ) : (
                        <Users className="w-4 h-4 text-gray-400 shrink-0" />
                      )}
                      <span className="flex-1 text-sm font-semibold text-gray-700 dark:text-gray-200 truncate">
                        {group.unit_name}
                      </span>
                      <span className="text-xs text-gray-400 bg-gray-200 dark:bg-gray-600 px-1.5 py-0.5 rounded-full shrink-0">
                        {group.users.length} نفر
                      </span>
                    </button>
                    {isOpen && (
                      <div className="divide-y divide-gray-50 dark:divide-gray-700/50">
                        {group.users.map(u => (
                          <UserRow
                            key={u.user_id}
                            userId={u.user_id}
                            name={u.full_name || u.email || ''}
                            email={u.email || ''}
                            subtitle={u.position_title || u.position || ''}
                            sending={sendingToUserId === u.user_id}
                            disabled={loading}
                            onSend={handleSendToUser}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function UserRow({
  userId, name, email, subtitle, sending, disabled, onSend,
}: {
  userId: string;
  name: string;
  email: string;
  subtitle: string;
  sending: boolean;
  disabled: boolean;
  onSend: (userId: string, name: string) => void;
}) {
  return (
    <div className="flex items-center justify-between px-3 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700/40 transition-colors">
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400 text-xs font-bold shrink-0">
          {(name || email || '?')[0]}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-800 dark:text-white truncate">{name}</p>
          <p className="text-xs text-gray-400 truncate">{subtitle || email}</p>
        </div>
      </div>
      <button
        onClick={() => onSend(userId, name)}
        disabled={disabled || sending}
        className="flex items-center gap-1 bg-blue-500 hover:bg-blue-600 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg text-xs font-medium transition-colors shrink-0 mr-2"
      >
        {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
        ارسال
      </button>
    </div>
  );
}
