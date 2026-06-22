import React, { useState, useRef } from 'react';
import { X, Settings, Users, Trash2, Shield, Globe, Lock, Image, AlertTriangle, UserPlus, UserMinus, Crown, LogOut, Link, Copy, Check, CreditCard as Edit2, Save, BellOff, Bell, ChevronRight } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';
import type { Channel, ChannelMember, ChannelProfile, MemberRole } from './types';

type MemberWithProfile = ChannelMember & { profile: ChannelProfile | null };

type Section = 'general' | 'members' | 'danger';

interface Props {
  channel: Channel;
  myRole: MemberRole | null;
  currentUserId: string | null;
  members: MemberWithProfile[];
  allProfiles: ChannelProfile[];
  onClose: () => void;
  onUpdated: () => void;
  onDeleted: () => void;
  onAddMember: (userId: string) => Promise<void>;
  onRemoveMember: (userId: string) => Promise<void>;
  onChangeRole: (userId: string, role: MemberRole) => Promise<void>;
}

const SECTION_LABELS: Record<Section, string> = {
  general: 'تنظیمات عمومی',
  members: 'مدیریت اعضا',
  danger: 'عملیات خطرناک',
};

export function ChannelSettingsModal({
  channel, myRole, currentUserId, members, allProfiles,
  onClose, onUpdated, onDeleted, onAddMember, onRemoveMember, onChangeRole,
}: Props) {
  const [section, setSection] = useState<Section>('general');
  const isAdmin = myRole === 'admin';
  const isCreator = channel.created_by === currentUserId;

  return (
    <div className="fixed inset-0 bg-black/50 z-[80]" onClick={onClose} dir="rtl">
      <div
        className="absolute inset-y-0 left-0 w-full max-w-lg bg-white dark:bg-gray-900 shadow-2xl flex flex-col"
        style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700 flex-shrink-0">
          <div className="flex items-center gap-3">
            <Settings className="w-5 h-5 text-teal-500" />
            <div>
              <h3 className="text-sm font-bold dark:text-white">تنظیمات مدیریتی</h3>
              <p className="text-xs text-gray-400 truncate max-w-[200px]">{channel.name}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Section nav */}
        <div className="flex border-b border-gray-100 dark:border-gray-700 flex-shrink-0">
          {(Object.keys(SECTION_LABELS) as Section[]).map(s => (
            <button key={s} onClick={() => setSection(s)}
              className={`flex-1 py-2.5 text-xs font-medium transition-colors ${section === s ? 'text-teal-600 dark:text-teal-400 border-b-2 border-teal-500' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'}`}>
              {SECTION_LABELS[s]}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto">
          {section === 'general' && (
            <GeneralSection
              channel={channel}
              isAdmin={isAdmin}
              currentUserId={currentUserId}
              onUpdated={onUpdated}
            />
          )}
          {section === 'members' && (
            <MembersSection
              channel={channel}
              members={members}
              allProfiles={allProfiles}
              currentUserId={currentUserId}
              isAdmin={isAdmin}
              isCreator={isCreator}
              onAddMember={onAddMember}
              onRemoveMember={onRemoveMember}
              onChangeRole={onChangeRole}
              onLeave={() => { onRemoveMember(currentUserId!); onClose(); }}
            />
          )}
          {section === 'danger' && (
            <DangerSection
              channel={channel}
              isAdmin={isAdmin}
              isCreator={isCreator}
              currentUserId={currentUserId}
              members={members}
              allProfiles={allProfiles}
              onDeleted={onDeleted}
              onClose={onClose}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function GeneralSection({ channel, isAdmin, currentUserId, onUpdated }: {
  channel: Channel;
  isAdmin: boolean;
  currentUserId: string | null;
  onUpdated: () => void;
}) {
  const [name, setName] = useState(channel.name);
  const [description, setDescription] = useState(channel.description || '');
  const [isPrivate, setIsPrivate] = useState(channel.is_private);
  const [isLocked, setIsLocked] = useState((channel as any).is_locked ?? false);
  const [avatarUrl, setAvatarUrl] = useState((channel as any).avatar_url || '');
  const [saving, setSaving] = useState(false);
  const [inviteCopied, setInviteCopied] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const { error } = await supabase.from('channels').update({
        name: name.trim(),
        description: description.trim() || null,
        is_private: isPrivate,
        is_locked: isLocked,
        avatar_url: avatarUrl || null,
      }).eq('id', channel.id);
      if (error) { toast.error('خطا: ' + error.message); return; }
      toast.success('تنظیمات ذخیره شد');
      onUpdated();
    } finally { setSaving(false); }
  };

  const handleAvatarUpload = async (file: File) => {
    const ext = file.name.split('.').pop();
    const path = `channel-avatars/${channel.id}.${ext}`;
    const { error: upErr } = await supabase.storage.from('attachments').upload(path, file, { upsert: true });
    if (upErr) { toast.error('خطا در آپلود تصویر'); return; }
    const { data } = supabase.storage.from('attachments').getPublicUrl(path);
    setAvatarUrl(data.publicUrl);
  };

  const copyInviteLink = () => {
    navigator.clipboard.writeText(`${window.location.origin}?invite=${channel.id}`);
    setInviteCopied(true);
    setTimeout(() => setInviteCopied(false), 2000);
  };

  const inp = 'w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500/40 disabled:opacity-50 disabled:cursor-not-allowed';

  return (
    <div className="p-5 space-y-5">
      {/* Avatar */}
      <div className="flex flex-col items-center gap-3 py-2">
        <div className="relative">
          <div className="w-20 h-20 rounded-2xl overflow-hidden bg-teal-100 dark:bg-teal-900/30 flex items-center justify-center">
            {avatarUrl ? (
              <img src={avatarUrl} alt="" className="w-full h-full object-cover" />
            ) : (
              <span className="text-3xl font-bold text-teal-600 dark:text-teal-400">{channel.name.charAt(0)}</span>
            )}
          </div>
          {isAdmin && (
            <button
              onClick={() => fileRef.current?.click()}
              className="absolute -bottom-1 -left-1 w-7 h-7 bg-teal-500 hover:bg-teal-600 text-white rounded-full flex items-center justify-center shadow-lg transition-colors"
            >
              <Image className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <input ref={fileRef} type="file" accept="image/*" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleAvatarUpload(f); }} />
        <p className="text-xs text-gray-400">
          {channel.type === 'channel' ? 'کانال' : 'گروه'} • {channel.member_count} عضو
        </p>
      </div>

      {/* Name */}
      <div>
        <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5">
          نام {channel.type === 'channel' ? 'کانال' : 'گروه'}
        </label>
        <input value={name} onChange={e => setName(e.target.value)} disabled={!isAdmin}
          className={inp} placeholder="نام..." />
      </div>

      {/* Description */}
      <div>
        <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5">توضیحات</label>
        <textarea value={description} onChange={e => setDescription(e.target.value)} disabled={!isAdmin}
          rows={3} className={inp + ' resize-none'} placeholder="توضیح کوتاه..." />
      </div>

      {/* Privacy toggle */}
      {isAdmin && (
        <div className="flex items-center justify-between p-3.5 bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3">
            {isPrivate ? <Lock className="w-4 h-4 text-gray-500" /> : <Globe className="w-4 h-4 text-teal-500" />}
            <div>
              <p className="text-sm font-medium dark:text-white">{isPrivate ? 'خصوصی' : 'عمومی'}</p>
              <p className="text-xs text-gray-400">{isPrivate ? 'فقط با دعوت' : 'همه می‌توانند عضو شوند'}</p>
            </div>
          </div>
          <button
            onClick={() => setIsPrivate(v => !v)}
            className={`w-10 h-5.5 rounded-full transition-colors relative flex-shrink-0 ${isPrivate ? 'bg-gray-400' : 'bg-teal-500'}`}
            style={{ width: 40, height: 22 }}
          >
            <span className={`absolute top-0.5 w-4.5 h-4.5 bg-white rounded-full shadow transition-transform ${isPrivate ? 'right-0.5' : 'left-0.5'}`}
              style={{ width: 18, height: 18, transform: isPrivate ? 'translateX(0)' : 'translateX(18px)' }} />
          </button>
        </div>
      )}

      {/* Lock messages */}
      {isAdmin && (
        <div className="flex items-center justify-between p-3.5 bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3">
            {isLocked ? <BellOff className="w-4 h-4 text-red-500" /> : <Bell className="w-4 h-4 text-gray-500" />}
            <div>
              <p className="text-sm font-medium dark:text-white">{isLocked ? 'ارسال پیام قفل است' : 'ارسال پیام آزاد'}</p>
              <p className="text-xs text-gray-400">{isLocked ? 'فقط مدیران می‌توانند پیام بدهند' : 'همه اعضا می‌توانند پیام بدهند'}</p>
            </div>
          </div>
          <button
            onClick={() => setIsLocked(v => !v)}
            className={`relative flex-shrink-0 rounded-full transition-colors ${isLocked ? 'bg-red-500' : 'bg-gray-300 dark:bg-gray-600'}`}
            style={{ width: 40, height: 22 }}
          >
            <span className={`absolute top-0.5 w-4.5 h-4.5 bg-white rounded-full shadow transition-transform`}
              style={{ width: 18, height: 18, transform: isLocked ? 'translateX(18px)' : 'translateX(2px)' }} />
          </button>
        </div>
      )}

      {/* Invite link */}
      <div className="p-3.5 bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
        <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">لینک دعوت</p>
        <div className="flex gap-2">
          <input readOnly value={`${window.location.origin}?invite=${channel.id}`}
            className="flex-1 text-xs px-3 py-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg dark:text-white" dir="ltr" />
          <button onClick={copyInviteLink}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors flex-shrink-0 ${inviteCopied ? 'bg-green-500 text-white' : 'bg-teal-500 hover:bg-teal-600 text-white'}`}>
            {inviteCopied ? <><Check className="w-3.5 h-3.5" />کپی شد</> : <><Copy className="w-3.5 h-3.5" />کپی</>}
          </button>
        </div>
      </div>

      {/* Save */}
      {isAdmin && (
        <button onClick={save} disabled={saving || !name.trim()}
          className="w-full flex items-center justify-center gap-2 py-2.5 bg-teal-500 hover:bg-teal-600 disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition-colors">
          {saving ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Save className="w-4 h-4" />}
          ذخیره تغییرات
        </button>
      )}
    </div>
  );
}

function MembersSection({ channel, members, allProfiles, currentUserId, isAdmin, isCreator, onAddMember, onRemoveMember, onChangeRole, onLeave }: {
  channel: Channel;
  members: MemberWithProfile[];
  allProfiles: ChannelProfile[];
  currentUserId: string | null;
  isAdmin: boolean;
  isCreator: boolean;
  onAddMember: (userId: string) => Promise<void>;
  onRemoveMember: (userId: string) => Promise<void>;
  onChangeRole: (userId: string, role: MemberRole) => Promise<void>;
  onLeave: () => void;
}) {
  const [search, setSearch] = useState('');
  const [addSearch, setAddSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const memberIds = new Set(members.map(m => m.user_id));

  const filtered = members.filter(m => {
    const name = (m.profile?.full_name || m.profile?.email || '').toLowerCase();
    return !search || name.includes(search.toLowerCase());
  });

  const addCandidates = allProfiles.filter(p =>
    !memberIds.has(p.user_id) &&
    (!addSearch || (p.full_name || p.email || '').toLowerCase().includes(addSearch.toLowerCase()))
  );

  return (
    <div className="p-4 space-y-4">
      {/* Member count + add button */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500 dark:text-gray-400">{members.length} عضو</p>
        {isAdmin && (
          <button onClick={() => setShowAdd(v => !v)}
            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${showAdd ? 'bg-teal-500 text-white' : 'bg-teal-50 dark:bg-teal-900/20 text-teal-600 dark:text-teal-400 hover:bg-teal-100'}`}>
            <UserPlus className="w-3.5 h-3.5" /> افزودن عضو
          </button>
        )}
      </div>

      {/* Add member panel */}
      {showAdd && isAdmin && (
        <div className="border border-teal-200 dark:border-teal-700 rounded-xl overflow-hidden">
          <div className="p-3 border-b border-teal-100 dark:border-teal-800 bg-teal-50/50 dark:bg-teal-900/10">
            <input value={addSearch} onChange={e => setAddSearch(e.target.value)} autoFocus
              placeholder="جستجوی کاربر برای افزودن..."
              className="w-full text-sm px-3 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg dark:text-white focus:outline-none focus:ring-1 focus:ring-teal-500/40" />
          </div>
          <div className="max-h-48 overflow-y-auto">
            {addCandidates.slice(0, 20).map(p => (
              <button key={p.user_id}
                onClick={async () => { await onAddMember(p.user_id); setShowAdd(false); setAddSearch(''); }}
                className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-teal-50 dark:hover:bg-teal-900/20 transition-colors text-right">
                <div className="w-8 h-8 rounded-full bg-teal-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                  {(p.full_name || p.email || 'U').charAt(0).toUpperCase()}
                </div>
                <div>
                  <p className="text-sm text-gray-800 dark:text-white">{p.full_name || p.email}</p>
                  {p.full_name && <p className="text-xs text-gray-400">{p.email}</p>}
                </div>
              </button>
            ))}
            {addCandidates.length === 0 && (
              <p className="text-xs text-gray-400 text-center py-6">کاربری یافت نشد</p>
            )}
          </div>
        </div>
      )}

      {/* Search existing members */}
      <input value={search} onChange={e => setSearch(e.target.value)}
        placeholder="جستجو در اعضا..."
        className="w-full text-sm px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-xl dark:text-white focus:outline-none focus:ring-1 focus:ring-teal-500/40" />

      {/* Member list */}
      <div className="space-y-2">
        {filtered.map(m => {
          const isSelf = m.user_id === currentUserId;
          const isOwner = m.user_id === channel.created_by;
          return (
            <div key={m.id} className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-xl">
              <div className="w-9 h-9 rounded-full bg-teal-500 flex items-center justify-center text-white text-sm font-bold flex-shrink-0 relative">
                {(m.profile?.full_name || m.profile?.email || 'U').charAt(0).toUpperCase()}
                {isOwner && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 bg-yellow-400 rounded-full flex items-center justify-center">
                    <Crown className="w-2.5 h-2.5 text-white" />
                  </span>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800 dark:text-white truncate">
                  {m.profile?.full_name || m.profile?.email || 'کاربر'}
                  {isSelf && <span className="text-xs text-gray-400 mr-1">(شما)</span>}
                </p>
                <p className="text-xs text-gray-400">{m.role === 'admin' ? 'مدیر' : 'عضو'}</p>
              </div>
              {isAdmin && !isSelf && (
                <div className="flex items-center gap-1 flex-shrink-0">
                  {/* Promote/demote */}
                  <button
                    onClick={() => onChangeRole(m.user_id, m.role === 'admin' ? 'member' : 'admin')}
                    title={m.role === 'admin' ? 'تبدیل به عضو عادی' : 'تبدیل به مدیر'}
                    className={`p-1.5 rounded-lg transition-colors ${m.role === 'admin' ? 'text-teal-500 hover:bg-teal-50 dark:hover:bg-teal-900/20' : 'text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'}`}>
                    <Shield className="w-3.5 h-3.5" />
                  </button>
                  {/* Remove */}
                  {!isOwner && (
                    <button onClick={() => onRemoveMember(m.user_id)}
                      title="خارج کردن از گروه"
                      className="p-1.5 rounded-lg text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                      <UserMinus className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Leave group */}
      {!isCreator && (
        <button onClick={onLeave}
          className="w-full flex items-center justify-center gap-2 py-2.5 border border-red-200 dark:border-red-800 text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-xl text-sm font-medium transition-colors mt-2">
          <LogOut className="w-4 h-4" />
          خروج داوطلبانه از {channel.type === 'channel' ? 'کانال' : 'گروه'}
        </button>
      )}
    </div>
  );
}

function DangerSection({ channel, isAdmin, isCreator, currentUserId, members, allProfiles, onDeleted, onClose }: {
  channel: Channel;
  isAdmin: boolean;
  isCreator: boolean;
  currentUserId: string | null;
  members: MemberWithProfile[];
  allProfiles: ChannelProfile[];
  onDeleted: () => void;
  onClose: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [transferTo, setTransferTo] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [transferring, setTransferring] = useState(false);

  const otherAdmins = members.filter(m => m.user_id !== currentUserId && m.role === 'admin');
  const otherMembers = members.filter(m => m.user_id !== currentUserId);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await supabase.from('channel_messages').delete().eq('channel_id', channel.id);
      await supabase.from('channel_members').delete().eq('channel_id', channel.id);
      const { error } = await supabase.from('channels').delete().eq('id', channel.id);
      if (error) { toast.error('خطا در حذف: ' + error.message); return; }
      toast.success(`${channel.type === 'channel' ? 'کانال' : 'گروه'} حذف شد`);
      onDeleted();
    } finally { setDeleting(false); }
  };

  const handleTransfer = async () => {
    if (!transferTo) return;
    setTransferring(true);
    try {
      await supabase.from('channels').update({ created_by: transferTo }).eq('id', channel.id);
      await supabase.from('channel_members').update({ role: 'admin' }).eq('channel_id', channel.id).eq('user_id', transferTo);
      toast.success('مالکیت منتقل شد');
      onClose();
    } finally { setTransferring(false); }
  };

  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3 px-6 text-center">
        <Shield className="w-10 h-10 text-gray-300 dark:text-gray-600" />
        <p className="text-sm text-gray-400">فقط مدیران به این بخش دسترسی دارند</p>
      </div>
    );
  }

  return (
    <div className="p-5 space-y-4">
      {/* Transfer ownership */}
      {isCreator && (
        <div className="border border-amber-200 dark:border-amber-700 rounded-xl overflow-hidden">
          <div className="px-4 py-3 bg-amber-50 dark:bg-amber-900/10 flex items-center gap-2">
            <Crown className="w-4 h-4 text-amber-500 flex-shrink-0" />
            <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">انتقال مالکیت</p>
          </div>
          <div className="p-4 space-y-3">
            <p className="text-xs text-gray-500 dark:text-gray-400">مالکیت {channel.type === 'channel' ? 'کانال' : 'گروه'} را به فرد دیگری منتقل کنید. این عمل برگشت‌پذیر نیست.</p>
            <select value={transferTo} onChange={e => setTransferTo(e.target.value)}
              className="w-full text-sm px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-xl dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-1 focus:ring-amber-500/40">
              <option value="">انتخاب کاربر...</option>
              {otherMembers.map(m => {
                const p = allProfiles.find(pr => pr.user_id === m.user_id);
                return <option key={m.user_id} value={m.user_id}>{p?.full_name || p?.email || 'کاربر'}</option>;
              })}
            </select>
            <button onClick={handleTransfer} disabled={!transferTo || transferring}
              className="w-full py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white rounded-xl text-sm font-medium transition-colors">
              {transferring ? 'در حال انتقال...' : 'انتقال مالکیت'}
            </button>
          </div>
        </div>
      )}

      {/* Delete */}
      {isCreator && (
        <div className="border border-red-200 dark:border-red-800 rounded-xl overflow-hidden">
          <div className="px-4 py-3 bg-red-50 dark:bg-red-900/10 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0" />
            <p className="text-sm font-semibold text-red-700 dark:text-red-400">
              حذف کامل {channel.type === 'channel' ? 'کانال' : 'گروه'}
            </p>
          </div>
          <div className="p-4 space-y-3">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              این عمل {channel.type === 'channel' ? 'کانال' : 'گروه'} و تمام پیام‌ها، فایل‌ها و اقدامات گروهی را برای همیشه حذف می‌کند.
            </p>
            {!confirmDelete ? (
              <button onClick={() => setConfirmDelete(true)}
                className="w-full py-2 border border-red-300 dark:border-red-700 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-xl text-sm font-medium transition-colors">
                حذف {channel.type === 'channel' ? 'کانال' : 'گروه'}
              </button>
            ) : (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-red-600 dark:text-red-400 text-center">مطمئن هستید؟</p>
                <div className="flex gap-2">
                  <button onClick={() => setConfirmDelete(false)}
                    className="flex-1 py-2 border border-gray-200 dark:border-gray-700 text-gray-500 rounded-xl text-sm transition-colors hover:bg-gray-50">
                    لغو
                  </button>
                  <button onClick={handleDelete} disabled={deleting}
                    className="flex-1 py-2 bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white rounded-xl text-sm font-medium transition-colors">
                    {deleting ? 'در حال حذف...' : 'بله، حذف شود'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {!isCreator && isAdmin && (
        <div className="flex flex-col items-center justify-center py-8 gap-3 text-center">
          <Shield className="w-8 h-8 text-gray-300 dark:text-gray-600" />
          <p className="text-sm text-gray-400">فقط مالک {channel.type === 'channel' ? 'کانال' : 'گروه'} به این عملیات دسترسی دارد</p>
        </div>
      )}
    </div>
  );
}
