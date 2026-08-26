import { useEffect, useState, type ReactNode } from 'react';
import moment from 'moment-jalaali';
import { Bell, Check, CheckCheck, MessageSquare, Tag, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';
import { FALLBACK_NAME } from '../../lib/useOrgUsers';
import type { ChatTag, UserProfile } from './types';

export function MentionProfilePopup({ user, currentUserId, onClose, onOpenDirectChat }: {
  user: UserProfile;
  currentUserId: string;
  onClose: () => void;
  onOpenDirectChat?: (userId: string) => void;
}) {
  const [positionTitle, setPositionTitle] = useState<string | null>(null);
  const [unitName, setUnitName] = useState<string | null>(null);
  const [loadingPosition, setLoadingPosition] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase
          .from('org_position_members')
          .select('org_positions(title, org_units(name))')
          .eq('user_id', user.user_id)
          .eq('is_primary', true)
          .maybeSingle();
        const pos = (data as any)?.org_positions;
        setPositionTitle(pos?.title || null);
        setUnitName(pos?.org_units?.name || null);
      } catch {
        // Preserve the existing silent profile-detail fallback.
      } finally {
        setLoadingPosition(false);
      }
    })();
  }, [user.user_id]);

  const name = user.full_name || FALLBACK_NAME;
  const initial = name.charAt(0).toUpperCase();
  const isSelf = user.user_id === currentUserId;

  const handleDM = () => {
    if (onOpenDirectChat) {
      onOpenDirectChat(user.user_id);
      onClose();
    } else {
      toast('برای چت خصوصی به بخش چت سازمانی بروید', { icon: '💬' });
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-[500] flex items-center justify-center p-4" onClick={onClose} dir="rtl">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden" onClick={event => event.stopPropagation()}>
        <div className="flex justify-between items-center px-5 pt-4 pb-2 border-b border-gray-100 dark:border-gray-800">
          <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300">پروفایل کاربر</h3>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors">
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>

        <div className="px-5 py-4 flex items-center gap-4">
          {user.avatar_url ? (
            <img src={user.avatar_url} alt={name} className="w-16 h-16 rounded-2xl object-cover flex-shrink-0" />
          ) : (
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-teal-500 flex items-center justify-center text-white text-2xl font-bold flex-shrink-0">
              {initial}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="font-bold text-gray-900 dark:text-white text-base truncate">{name}</p>
            {loadingPosition ? (
              <div className="w-24 h-3 bg-gray-200 dark:bg-gray-700 rounded animate-pulse mt-1.5" />
            ) : positionTitle ? (
              <p className="text-sm text-blue-600 dark:text-blue-400 truncate mt-0.5">{positionTitle}</p>
            ) : (
              <p className="text-sm text-gray-400 dark:text-gray-500 mt-0.5">بدون سمت سازمانی</p>
            )}
            {!loadingPosition && unitName && (
              <p className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">{unitName}</p>
            )}
          </div>
        </div>

        <div className="px-5 pb-5 pt-1 space-y-2">
          {!isSelf && (
            <button onClick={handleDM} className="w-full flex items-center gap-3 px-4 py-3 bg-blue-500 hover:bg-blue-600 active:bg-blue-700 text-white rounded-xl transition-colors font-medium">
              <MessageSquare className="w-4 h-4 flex-shrink-0" />
              <span className="text-sm">پیام خصوصی</span>
            </button>
          )}
          <button onClick={onClose} className="w-full flex items-center justify-center px-4 py-2.5 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-sm">
            بستن
          </button>
        </div>
      </div>
    </div>
  );
}

export function ReminderModal({ messageId, messageBody, currentUserId, onClose, onSaved }: {
  messageId: string;
  messageBody: string | null;
  currentUserId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [selectedPreset, setSelectedPreset] = useState<number | null>(null);
  const [customMinutes, setCustomMinutes] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const presets = [
    { label: '۳۰ دقیقه', minutes: 30 },
    { label: '۱ ساعت', minutes: 60 },
    { label: '۲ ساعت', minutes: 120 },
    { label: '۴ ساعت', minutes: 240 },
    { label: 'فردا', minutes: 24 * 60 },
  ];

  const save = async () => {
    const mins = selectedPreset !== null ? selectedPreset : parseInt(customMinutes);
    if (!mins || mins <= 0) {
      toast.error('زمان یادآوری را انتخاب کنید');
      return;
    }
    setSaving(true);
    const remindAt = new Date(Date.now() + mins * 60 * 1000).toISOString();
    const { error } = await supabase.from('chat_reminders').insert({ message_id: messageId, user_id: currentUserId, remind_at: remindAt, note });
    setSaving(false);
    if (error) {
      toast.error('خطا در ذخیره یادآوری');
      return;
    }
    toast.success('یادآوری تنظیم شد');
    onSaved();
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" dir="rtl">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
          <div className="flex items-center gap-2">
            <Bell className="w-5 h-5 text-amber-500" />
            <h3 className="font-bold text-gray-900 dark:text-white">تنظیم یادآوری</h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-4">
          {messageBody && (
            <div className="bg-gray-50 dark:bg-gray-800 rounded-xl px-4 py-3 text-sm text-gray-700 dark:text-gray-300 border border-gray-100 dark:border-gray-700 line-clamp-2">
              {messageBody}
            </div>
          )}
          <div>
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">زمان پیگیری</p>
            <div className="grid grid-cols-3 gap-2 mb-2">
              {presets.map(preset => (
                <button
                  key={preset.minutes}
                  onClick={() => { setSelectedPreset(preset.minutes); setCustomMinutes(''); }}
                  className={`py-2 rounded-xl text-sm font-medium transition-colors border ${selectedPreset === preset.minutes ? 'bg-amber-500 text-white border-amber-500' : 'bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:border-amber-300'}`}
                >
                  {preset.label}
                </button>
              ))}
              <input
                type="number"
                placeholder="دقیقه دلخواه"
                value={customMinutes}
                onChange={event => { setCustomMinutes(event.target.value); setSelectedPreset(null); }}
                className="col-span-2 py-2 px-3 rounded-xl text-sm border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 dark:text-white outline-none focus:border-amber-400 text-center"
              />
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">توضیحات</p>
            <textarea
              value={note}
              onChange={event => setNote(event.target.value)}
              rows={2}
              placeholder="توضیحات اختیاری..."
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-gray-50 dark:bg-gray-800 dark:text-white outline-none focus:border-amber-400 resize-none"
            />
          </div>
          <div className="flex gap-2 pt-1">
            <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800">لغو</button>
            <button onClick={save} disabled={saving} className="flex-1 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold disabled:opacity-50">
              {saving ? '...' : 'تنظیم'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function TagModal({ messageId, currentTags, currentUserId, onClose, onChanged }: {
  messageId: string;
  currentTags: ChatTag[];
  currentUserId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [allTags, setAllTags] = useState<ChatTag[]>([]);
  const [newTagName, setNewTagName] = useState('');
  const [newTagColor, setNewTagColor] = useState('#10B981');
  const [loading, setLoading] = useState(false);
  const tagColors = ['#10B981', '#3B82F6', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#14B8A6', '#F97316'];

  useEffect(() => {
    supabase.from('chat_tags').select('*').eq('user_id', currentUserId).then(({ data }) => setAllTags(data || []));
  }, [currentUserId]);

  const isAssigned = (tagId: string) => currentTags.some(tag => tag.id === tagId);

  const toggleTag = async (tag: ChatTag) => {
    if (isAssigned(tag.id)) {
      await supabase.from('chat_message_tag_assignments').delete().eq('message_id', messageId).eq('tag_id', tag.id).eq('user_id', currentUserId);
    } else {
      await supabase.from('chat_message_tag_assignments').insert({ message_id: messageId, tag_id: tag.id, user_id: currentUserId });
    }
    onChanged();
  };

  const addTag = async () => {
    if (!newTagName.trim()) return;
    setLoading(true);
    const { data, error } = await supabase.from('chat_tags').insert({ user_id: currentUserId, name: newTagName.trim(), color: newTagColor }).select().maybeSingle();
    setLoading(false);
    if (error) {
      toast.error('خطا');
      return;
    }
    if (data) setAllTags(tags => [...tags, data]);
    setNewTagName('');
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" dir="rtl">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
          <div className="flex items-center gap-2"><Tag className="w-4 h-4 text-blue-500" /><h3 className="font-bold text-gray-900 dark:text-white">تگ‌های پیام</h3></div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="flex flex-wrap gap-2 min-h-[40px]">
            {allTags.length === 0 && <p className="text-sm text-gray-400">تگی ایجاد نشده</p>}
            {allTags.map(tag => (
              <button
                key={tag.id}
                onClick={() => toggleTag(tag)}
                className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-sm font-medium transition-all border-2 ${isAssigned(tag.id) ? 'text-white border-transparent' : 'border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800'}`}
                style={isAssigned(tag.id) ? { backgroundColor: tag.color } : {}}
              >
                {isAssigned(tag.id) && <Check className="w-3 h-3" />}{tag.name}
              </button>
            ))}
          </div>
          <div className="border-t border-gray-100 dark:border-gray-800 pt-4">
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">افزودن تگ جدید</p>
            <div className="flex gap-1.5 mb-2">
              {tagColors.map(color => (
                <button
                  key={color}
                  onClick={() => setNewTagColor(color)}
                  className={`w-6 h-6 rounded-full transition-transform ${newTagColor === color ? 'scale-125 ring-2 ring-offset-1 ring-gray-300' : ''}`}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
            <div className="flex gap-2">
              <input
                value={newTagName}
                onChange={event => setNewTagName(event.target.value)}
                onKeyDown={event => event.key === 'Enter' && addTag()}
                placeholder="نام تگ..."
                className="flex-1 px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-gray-50 dark:bg-gray-800 dark:text-white outline-none focus:border-blue-400"
              />
              <button onClick={addTag} disabled={loading} className="px-3 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-xl text-sm font-medium disabled:opacity-50">افزودن</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ChatMessageMenuItem({ icon, label, labelClass, onClick }: {
  icon: ReactNode;
  label: string;
  labelClass?: string;
  onClick: () => void;
}) {
  return (
    <button onClick={onClick} className="w-full flex items-center gap-3 px-4 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors text-right">
      <span className="text-gray-400 dark:text-gray-500 flex-shrink-0">{icon}</span>
      <span className={labelClass || 'text-gray-700 dark:text-gray-300'}>{label}</span>
    </button>
  );
}

export function ChatViewersModal({ messageId, conversationId, messageCreatedAt, currentUserId, allUsers, readBy, onClose }: {
  messageId: string;
  conversationId: string;
  messageCreatedAt: string;
  currentUserId: string;
  allUsers: UserProfile[];
  readBy: string[];
  onClose: () => void;
}) {
  const [seenLog, setSeenLog] = useState<Array<{ user_id: string; seen_at: string }>>([]);
  const [logLoading, setLogLoading] = useState(true);

  useEffect(() => {
    supabase
      .from('chat_message_read_log')
      .select('user_id, seen_at')
      .eq('message_id', messageId)
      .then(({ data }) => {
        if (data && data.length > 0) {
          setSeenLog(data.map((row: any) => ({ user_id: row.user_id, seen_at: row.seen_at })));
          setLogLoading(false);
        } else {
          supabase
            .from('chat_message_read_receipts')
            .select('user_id, last_read_at')
            .eq('conversation_id', conversationId)
            .neq('user_id', currentUserId)
            .gte('last_read_at', messageCreatedAt)
            .then(({ data: fallback }) => {
              setSeenLog((fallback || []).map((row: any) => ({ user_id: row.user_id, seen_at: row.last_read_at })));
              setLogLoading(false);
            });
        }
      });
  }, [messageId, conversationId, currentUserId, messageCreatedAt]);

  const seenIds = new Set(readBy.filter(id => id !== currentUserId));
  const viewers = [...seenIds].map(uid => {
    const profile = allUsers.find(user => user.user_id === uid);
    const logEntry = seenLog.find(log => log.user_id === uid);
    return { uid, profile, seen_at: logEntry?.seen_at ?? null };
  });

  const formatTime = (iso: string | null) => iso ? moment(iso).format('jYYYY/jMM/jDD - HH:mm') : null;

  return (
    <div className="fixed inset-0 bg-black/40 z-[400] flex items-end sm:items-center justify-center p-4" dir="rtl" onClick={onClose}>
      <div className="w-full sm:w-80 bg-white dark:bg-gray-900 rounded-2xl shadow-2xl overflow-hidden" onClick={event => event.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100 dark:border-gray-800">
          <div className="flex items-center gap-2">
            <CheckCheck className="w-4 h-4 text-teal-500" />
            <h3 className="text-sm font-bold text-gray-900 dark:text-white">مشاهده‌کنندگان پیام</h3>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="max-h-72 overflow-y-auto">
          {viewers.length > 0 ? (
            <div className="px-4 py-3">
              <p className="text-[11px] font-semibold text-teal-600 dark:text-teal-400 flex items-center gap-1 mb-3">
                <CheckCheck className="w-3.5 h-3.5" /> دیده شده توسط ({viewers.length})
              </p>
              {viewers.map(({ uid, profile, seen_at }) => (
                <div key={uid} className="flex items-center gap-3 py-2">
                  {profile?.avatar_url ? (
                    <img src={profile.avatar_url} alt="" className="w-8 h-8 rounded-full object-cover flex-shrink-0" />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-teal-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                      {(profile?.full_name || FALLBACK_NAME).charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 dark:text-white truncate">{profile?.full_name || FALLBACK_NAME}</p>
                    {logLoading ? (
                      <p className="text-[11px] text-gray-400 mt-0.5">در حال بارگذاری...</p>
                    ) : seen_at ? (
                      <p className="text-[11px] text-teal-500 dark:text-teal-400 mt-0.5">{formatTime(seen_at)}</p>
                    ) : (
                      <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">زمان نامشخص</p>
                    )}
                  </div>
                  <CheckCheck className="w-4 h-4 text-teal-400 flex-shrink-0" />
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-400 text-center py-8">هنوز کسی این پیام را ندیده</p>
          )}
        </div>
      </div>
    </div>
  );
}
