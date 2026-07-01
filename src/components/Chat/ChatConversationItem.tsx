import React, { useState, useRef, useEffect } from 'react';
import moment from 'moment-jalaali';
import { MoreVertical, Pin, Trash2, Clock, Bookmark } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import type { ConversationWithProfile } from './types';
const STATUS_DOT: Record<string, string> = {
  online:  'bg-green-500',
  busy:    'bg-amber-500',
  away:    'bg-blue-500',
  dnd:     'bg-red-500',
  offline: 'bg-gray-400',
};

interface Props {
  conversation: ConversationWithProfile;
  isActive: boolean;
  currentUserId: string | null;
  lastSeen?: string | null;
  onClick: () => void;
  onMentionClick?: (messageId: string) => void;
  onTogglePin?: (convId: string) => void;
  onAction?: () => void;
}

function Avatar({ name, size = 'md', avatarUrl, status, isOnline }: {
  name: string;
  size?: 'sm' | 'md';
  avatarUrl?: string | null;
  status?: string | null;
  isOnline?: boolean | null;
}) {
  const colors = ['bg-blue-500', 'bg-green-500', 'bg-amber-500', 'bg-red-500', 'bg-teal-500', 'bg-cyan-500'];
  const color = colors[name.charCodeAt(0) % colors.length];
  const sz = size === 'sm' ? 'w-8 h-8 text-xs' : 'w-11 h-11 text-sm';
  const resolvedStatus = status ?? (isOnline ? 'online' : 'offline');
  const dotColor = STATUS_DOT[resolvedStatus] ?? STATUS_DOT.offline;

  return (
    <div className="relative shrink-0">
      {avatarUrl ? (
        <img src={avatarUrl} alt={name} className={`${sz} rounded-full object-cover`} />
      ) : (
        <div className={`${sz} ${color} rounded-full flex items-center justify-center text-white font-bold`}>
          {name.charAt(0)}
        </div>
      )}
      <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white dark:border-gray-800 ${dotColor}`} />
    </div>
  );
}

export function UserAvatar({ name, size = 'md', avatarUrl }: { name: string; size?: 'sm' | 'md'; avatarUrl?: string | null }) {
  return (
    <div className={`relative shrink-0 ${size === 'sm' ? 'w-8 h-8' : 'w-11 h-11'}`}>
      {avatarUrl ? (
        <img src={avatarUrl} alt={name} className="w-full h-full rounded-full object-cover" />
      ) : (
        <div className={`w-full h-full rounded-full flex items-center justify-center text-white font-bold text-sm ${['bg-blue-500', 'bg-green-500', 'bg-amber-500', 'bg-red-500', 'bg-teal-500', 'bg-cyan-500'][name.charCodeAt(0) % 6]}`}>
          {name.charAt(0)}
        </div>
      )}
    </div>
  );
}

function formatTime(iso: string | null) {
  if (!iso) return '';
  const m = moment(iso);
  const now = moment();
  if (m.isSame(now, 'day')) return m.format('HH:mm');
  if (m.isSame(now.clone().subtract(1, 'day'), 'day')) return 'دیروز';
  return m.format('jYYYY/jMM/jDD');
}

export function ChatConversationItem({ conversation: c, isActive, currentUserId, lastSeen, onClick, onMentionClick, onTogglePin, onAction }: Props) {
  const isSavedMessages = c.otherUser.user_id === currentUserId;
  const name = isSavedMessages ? 'پیام‌های ذخیره‌شده' : (c.otherUser.full_name || c.otherUser.email || 'کاربر');
  const isMine = c.last_message_sender_id === currentUserId;
  const preview = c.last_message_text
    ? (isMine ? `شما: ${c.last_message_text}` : c.last_message_text)
    : 'مکالمه جدید';
  const ONLINE_THRESHOLD = 3 * 60 * 1000;
  const isOnline = lastSeen && Date.now() - new Date(lastSeen).getTime() < ONLINE_THRESHOLD;

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  const handlePin = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setMenuOpen(false);
    onTogglePin?.(c.id); // instant optimistic move to top / back
    await supabase.rpc('toggle_pin_chat', { p_conversation_id: c.id });
    onAction?.(); // re-fetch to confirm DB state
  };

  const handleClear = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setMenuOpen(false);
    await supabase.rpc('clear_chat_for_user', { p_conversation_id: c.id });
    onAction?.();
  };

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setMenuOpen(false);
    await supabase.rpc('delete_chat_for_user', { p_conversation_id: c.id });
    onAction?.();
  };

  return (
    <div className="relative group" dir="rtl">
      <button
        onClick={onClick}
        className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors border-b border-gray-50 dark:border-gray-700/50 text-right ${isActive ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}
      >
        <div className="relative shrink-0">
          {isSavedMessages ? (
            <div className="w-11 h-11 rounded-full bg-teal-500 flex items-center justify-center">
              <Bookmark className="w-5 h-5 text-white" />
            </div>
          ) : (
            <Avatar
              name={name}
              avatarUrl={c.otherUser.avatar_url}
              status={c.otherUser.status}
              isOnline={isOnline}
            />
          )}
          {c.unreadCount > 0 && (
            <span className="absolute -top-1 -left-1 min-w-[18px] h-[18px] bg-blue-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1">
              {c.unreadCount > 99 ? '99+' : c.unreadCount}
            </span>
          )}
        </div>
        <div className="flex-1 min-w-0 text-right">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold text-gray-900 dark:text-white truncate">{name}</span>
            <div className="flex items-center gap-1.5 shrink-0">
              {c.isPinned && (
                <Pin className="w-3 h-3 text-blue-400 shrink-0" style={{ transform: 'rotate(45deg)' }} />
              )}
              {c.hasMention && c.mentionMessageId && (
                <button
                  onClick={e => { e.stopPropagation(); onClick(); onMentionClick?.(c.mentionMessageId!); }}
                  title="پیامی که شما را منشن کرده"
                  className="w-5 h-5 rounded-full bg-teal-500 text-white text-[10px] font-bold flex items-center justify-center hover:bg-teal-600 transition-colors leading-none"
                >
                  @
                </button>
              )}
              <span className="text-[10px] text-gray-400">{formatTime(c.last_message_at)}</span>
            </div>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">{preview}</p>
        </div>
      </button>

      {/* 3-dot menu trigger — visible on hover */}
      <button
        onClick={e => { e.stopPropagation(); setMenuOpen(v => !v); }}
        className="absolute left-2 top-1/2 -translate-y-1/2 p-1 rounded-lg opacity-0 group-hover:opacity-100 focus:opacity-100 bg-white dark:bg-gray-800 shadow-xs border border-gray-100 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 transition-all z-10"
        title="گزینه‌ها"
      >
        <MoreVertical className="w-3.5 h-3.5" />
      </button>

      {/* Dropdown */}
      {menuOpen && (
        <div
          ref={menuRef}
          className="absolute left-2 top-full mt-0.5 w-44 bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-100 dark:border-gray-700 z-50 overflow-hidden"
          dir="rtl"
        >
          {!isSavedMessages && (
            <button
              onClick={handlePin}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-right"
            >
              <Pin className="w-4 h-4 text-blue-500 shrink-0" />
              {c.isPinned ? 'برداشتن پین' : 'پین کردن'}
            </button>
          )}
          <button
            onClick={handleClear}
            className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-right ${!isSavedMessages ? 'border-t border-gray-50 dark:border-gray-700' : ''}`}
          >
            <Clock className="w-4 h-4 text-amber-500 shrink-0" />
            پاک کردن تاریخچه
          </button>
          {!isSavedMessages && (
            <button
              onClick={handleDelete}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors text-right border-t border-gray-50 dark:border-gray-700"
            >
              <Trash2 className="w-4 h-4 shrink-0" />
              حذف چت
            </button>
          )}
        </div>
      )}
    </div>
  );
}
