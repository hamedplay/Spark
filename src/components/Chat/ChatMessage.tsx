import { useState, useRef, useEffect } from 'react';
import moment from 'moment-jalaali';
import { Star, EllipsisVertical as MoreVertical, CreditCard as Edit2, Trash2, Bell, Copy, Play, Pause, Tag, Send, Check, CheckCheck, Loader, Reply, X, Smile, ClipboardList, BellRing, MessageSquare, Forward, Eye } from 'lucide-react';
import { EmojiPicker } from './EmojiPicker';
import type { MessageWithMeta, ChatTag, MessageStatus, UserProfile } from './types';
import { UserAvatar } from './ChatConversationItem';
import { ForwardModal } from './ForwardModal';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';
import { loadChatTheme } from './ChatSettingsPage';
import type { ChatThemeSettings } from './ChatSettingsPage';

const DELETED_MESSAGE_TEXT = '⛔ این پیام حذف شده است';

function useDarkMode() {
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains('dark'));
  useEffect(() => {
    const obs = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains('dark'));
    });
    obs.observe(document.documentElement, { attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);
  return isDark;
}

function useChatTheme(): ChatThemeSettings {
  const [theme, setTheme] = useState<ChatThemeSettings>(loadChatTheme);
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail) setTheme(detail as ChatThemeSettings);
      else setTheme(loadChatTheme());
    };
    window.addEventListener('chatThemeChanged', handler);
    return () => window.removeEventListener('chatThemeChanged', handler);
  }, []);
  return theme;
}

// Static border width class — color overridden via inline style
const TYPE_BORDER_CLASSES: Record<string, { own: string; other: string }> = {
  normal:       { own: '', other: '' },
  important:    { own: 'border-l-4', other: 'border-r-4' },
  urgent:       { own: 'border-l-4', other: 'border-r-4' },
  confidential: { own: 'border-l-4', other: 'border-r-4' },
};


interface Props {
  message: MessageWithMeta;
  isOwn: boolean;
  currentUserId: string;
  allUsers: UserProfile[];
  onReply: () => void;
  onEdit: () => void;
  onStar: () => void;
  onDeleteForMe: () => void;
  onDeleteForAll: () => void;
  onReact: (emoji: string) => void;
  onStatusChange: (status: MessageStatus) => void;
  onScheduleMeeting: (mentionedIds: string[], body: string) => void;
  onTagsChanged: () => void;
  onReminderSet: () => void;
  onScrollToMessage?: (messageId: string) => void;
  onRegisterAsTask?: (messageBody: string, messageId: string) => void;
  onMentionClick?: (user: UserProfile) => void;
  onOpenDirectChat?: (userId: string) => void;
}

type InlineToken =
  | { type: 'bold'; content: string }
  | { type: 'italic'; content: string }
  | { type: 'strike'; content: string }
  | { type: 'code'; content: string }
  | { type: 'link'; text: string; url: string }
  | { type: 'mention'; user: UserProfile }
  | { type: 'text'; content: string };

const INLINE_PATTERNS: Array<{ name: string; regex: RegExp }> = [
  { name: 'bold',   regex: /\*\*(.+?)\*\*/ },
  { name: 'italic', regex: /_([^_\n]+?)_/ },
  { name: 'strike', regex: /~~(.+?)~~/ },
  { name: 'code',   regex: /`([^`\n]+)`/ },
  { name: 'link',   regex: /\[([^\]\n]+)\]\((https?:\/\/[^)\n]+)\)/ },
];

function renderInline(
  text: string,
  currentUserId: string,
  allUsers: UserProfile[],
  onMentionClick?: (user: UserProfile) => void,
  keyOffset = 0
): React.ReactNode {
  if (!text) return null;

  const sortedUsers = allUsers
    .filter(u => u.full_name || u.email)
    .sort((a, b) => ((b.full_name || b.email || '').length) - ((a.full_name || a.email || '').length));

  const tokens: InlineToken[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    let earliest: { index: number; length: number; token: InlineToken } | null = null;

    for (const { name, regex } of INLINE_PATTERNS) {
      const match = regex.exec(remaining);
      if (match !== null && (earliest === null || match.index < earliest.index)) {
        let token: InlineToken;
        if (name === 'bold')        token = { type: 'bold',   content: match[1] };
        else if (name === 'italic') token = { type: 'italic', content: match[1] };
        else if (name === 'strike') token = { type: 'strike', content: match[1] };
        else if (name === 'code')   token = { type: 'code',   content: match[1] };
        else                        token = { type: 'link',   text: match[1], url: match[2] };
        earliest = { index: match.index, length: match[0].length, token };
      }
    }

    const atIdx = remaining.indexOf('@');
    if (atIdx >= 0) {
      const afterAt = remaining.slice(atIdx + 1);
      const matched = sortedUsers.find(u => {
        const name = u.full_name || u.email || '';
        return name && afterAt.startsWith(name);
      });
      if (matched && (earliest === null || atIdx < earliest.index)) {
        const name = matched.full_name || matched.email || '';
        earliest = { index: atIdx, length: 1 + name.length, token: { type: 'mention', user: matched } };
      }
    }

    if (earliest === null) { tokens.push({ type: 'text', content: remaining }); break; }
    if (earliest.index > 0) tokens.push({ type: 'text', content: remaining.slice(0, earliest.index) });
    tokens.push(earliest.token);
    remaining = remaining.slice(earliest.index + earliest.length);
  }

  return tokens.map((token, i) => {
    const key = keyOffset + i;
    switch (token.type) {
      case 'bold':
        return <strong key={key} className="font-semibold">{token.content}</strong>;
      case 'italic':
        return <em key={key} className="italic">{token.content}</em>;
      case 'strike':
        return <s key={key} className="line-through opacity-75">{token.content}</s>;
      case 'code':
        return (
          <code key={key} className="bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 px-1.5 py-0.5 rounded text-[0.85em] font-mono">
            {token.content}
          </code>
        );
      case 'link':
        return (
          <a key={key} href={token.url} target="_blank" rel="noopener noreferrer"
            className="text-blue-500 dark:text-blue-400 hover:underline break-all"
            onClick={e => e.stopPropagation()}>
            {token.text}
          </a>
        );
      case 'mention': {
        const isMe = token.user.user_id === currentUserId;
        const name = token.user.full_name || token.user.email || '';
        return (
          <span key={key}
            onClick={onMentionClick ? (e) => { e.stopPropagation(); onMentionClick(token.user); } : undefined}
            className={`inline-flex items-center gap-0.5 px-1 py-0.5 rounded font-semibold text-xs cursor-pointer hover:opacity-80 transition-opacity ${
              isMe ? 'bg-teal-100 dark:bg-teal-900/50 text-teal-700 dark:text-teal-300'
                   : 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
            }`}>
            @{name}
          </span>
        );
      }
      case 'text':
        return <span key={key}>{token.content}</span>;
    }
  });
}

function renderMarkdownBody(
  body: string,
  currentUserId: string,
  allUsers: UserProfile[],
  onMentionClick?: (user: UserProfile) => void
): React.ReactNode {
  const lines = body.split('\n');
  return (
    <>
      {lines.map((line, lineIdx) => {
        const baseKey = lineIdx * 10000;

        if (line === '') return <div key={lineIdx} className="h-[1em]" />;

        // Blockquote
        if (line.startsWith('> ')) {
          return (
            <div key={lineIdx} className="border-r-2 border-gray-400 dark:border-gray-500 pr-2 my-0.5 italic text-gray-600 dark:text-gray-400">
              {renderInline(line.slice(2), currentUserId, allUsers, onMentionClick, baseKey)}
            </div>
          );
        }

        // Bullet list (Unicode bullet • U+2022)
        if (line.startsWith('\u2022 ')) {
          return (
            <div key={lineIdx} className="flex items-start gap-1.5">
              <span className="text-gray-500 dark:text-gray-400 flex-shrink-0 mt-[0.15em] text-xs leading-5">●</span>
              <span className="flex-1 min-w-0">{renderInline(line.slice(2), currentUserId, allUsers, onMentionClick, baseKey)}</span>
            </div>
          );
        }

        // Numbered list
        const numMatch = line.match(/^(\d+)\. (.*)/);
        if (numMatch) {
          return (
            <div key={lineIdx} className="flex items-start gap-1.5">
              <span className="text-gray-500 dark:text-gray-400 flex-shrink-0 text-xs font-semibold min-w-[1.4rem] mt-[0.15em]">{numMatch[1]}.</span>
              <span className="flex-1 min-w-0">{renderInline(numMatch[2], currentUserId, allUsers, onMentionClick, baseKey)}</span>
            </div>
          );
        }

        return <div key={lineIdx}>{renderInline(line, currentUserId, allUsers, onMentionClick, baseKey)}</div>;
      })}
    </>
  );
}

export function ChatMessage({
  message, isOwn, currentUserId, allUsers,
  onReply, onEdit, onStar, onDeleteForMe, onDeleteForAll,
  onReact, onStatusChange, onScheduleMeeting, onTagsChanged, onReminderSet,
  onScrollToMessage, onRegisterAsTask, onMentionClick, onOpenDirectChat,
}: Props) {
  const [showMenu, setShowMenu] = useState(false);
  const [showReactPicker, setShowReactPicker] = useState(false);
  const [emojiPickerStyle, setEmojiPickerStyle] = useState<React.CSSProperties>({});
  const [confidentialRevealed, setConfidentialRevealed] = useState(false);
  const [isPlayingVoice, setIsPlayingVoice] = useState(false);
  const [voiceProgress, setVoiceProgress] = useState(0);
  const [showReminderModal, setShowReminderModal] = useState(false);
  const [showTagModal, setShowTagModal] = useState(false);
  const [showForwardModal, setShowForwardModal] = useState(false);
  const [showViewersModal, setShowViewersModal] = useState(false);
  const [mentionPopupUser, setMentionPopupUser] = useState<UserProfile | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const reactRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const openEmojiPicker = () => {
    if (reactRef.current) {
      const rect = reactRef.current.getBoundingClientRect();
      const pickerW = Math.min(288, window.innerWidth - 16);
      let left = rect.left;
      if (left + pickerW > window.innerWidth - 8) left = window.innerWidth - pickerW - 8;
      if (left < 8) left = 8;
      const style: React.CSSProperties = { position: 'fixed', left, zIndex: 9999 };
      if (rect.top >= 348) {
        style.bottom = window.innerHeight - rect.top + 4;
      } else {
        style.top = rect.bottom + 4;
      }
      setEmojiPickerStyle(style);
    }
    setShowReactPicker(v => !v);
  };

  const isConfidential = message.message_type === 'confidential';
  const shouldBlur = isConfidential && !isOwn && !confidentialRevealed;
  const seenByOther = isOwn && (message.read_by?.some(id => id !== currentUserId) ?? false);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (reactRef.current && !reactRef.current.contains(e.target as Node)) setShowReactPicker(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const toggleVoice = () => {
    if (!message.voice_url) return;
    if (!audioRef.current) {
      audioRef.current = new Audio(message.voice_url);
      audioRef.current.ontimeupdate = () => {
        if (audioRef.current) setVoiceProgress(audioRef.current.currentTime / (audioRef.current.duration || 1));
      };
      audioRef.current.onended = () => { setIsPlayingVoice(false); setVoiceProgress(0); };
    }
    if (isPlayingVoice) { audioRef.current.pause(); setIsPlayingVoice(false); }
    else { audioRef.current.play(); setIsPlayingVoice(true); }
  };

  const extractMentionIds = (text: string | null): string[] => {
    if (!text) return [];
    return allUsers
      .filter(u => { const name = u.full_name || u.email; return name && text.includes(`@${name}`); })
      .map(u => u.user_id);
  };

  const timeStr = moment(message.created_at).format('HH:mm');
  const mentionIds = extractMentionIds(message.body);
  const hasMentions = mentionIds.length > 0;
  const tags = message.tags || [];
  const isDeleted = message.body === DELETED_MESSAGE_TEXT;
  const formatDuration = (s: number) =>
    `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;

  const cycleStatus = () => {
    const next: Record<MessageStatus, MessageStatus> = { pending: 'in_progress', in_progress: 'done', done: 'pending' };
    onStatusChange(next[message.status || 'pending']);
  };

  const StatusSquare = () => {
    const s = message.status || 'pending';
    if (s === 'pending') return (
      <button onClick={cycleStatus} title="در انتظار — کلیک"
        className={`w-5 h-5 rounded border-2 flex-shrink-0 transition-colors ${isOwn ? 'border-emerald-300 hover:border-white' : 'border-gray-300 dark:border-gray-500 hover:border-gray-500'}`} />
    );
    if (s === 'in_progress') return (
      <button onClick={cycleStatus} title="در حال رسیدگی — کلیک"
        className="w-5 h-5 rounded border-2 border-amber-400 bg-amber-400 flex items-center justify-center flex-shrink-0">
        <Loader className="w-3 h-3 text-white animate-spin" />
      </button>
    );
    return (
      <button onClick={cycleStatus} title="رسیدگی شده — کلیک"
        className="w-5 h-5 rounded border-2 border-teal-500 bg-teal-500 flex items-center justify-center flex-shrink-0">
        <Check className="w-3 h-3 text-white" />
      </button>
    );
  };

  const theme = useChatTheme();
  const isDark = useDarkMode();

  const removeTag = async (tagId: string) => {
    await supabase.from('chat_message_tag_assignments')
      .delete().eq('message_id', message.id).eq('tag_id', tagId).eq('user_id', currentUserId);
    onTagsChanged();
  };

  // Dynamic card colors — override to dark-mode values when dark is active
  const cardStyle = isOwn
    ? { backgroundColor: isDark ? '#2a453d' : theme.sentBubbleColor }
    : { backgroundColor: isDark ? '#4d5049' : theme.receivedBubbleColor };
  const cardBg = 'text-gray-900 dark:text-white';
  const borderClass = 'border-gray-200 dark:border-gray-700';
  const dividerClass = 'border-gray-100 dark:border-gray-700';
  const iconClass = 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white';

  // Dynamic type border colors from theme
  const typeBorderStyle: React.CSSProperties = {};
  if (message.message_type === 'important') typeBorderStyle[isOwn ? 'borderLeftColor' : 'borderRightColor'] = theme.importantColor;
  else if (message.message_type === 'urgent') typeBorderStyle[isOwn ? 'borderLeftColor' : 'borderRightColor'] = theme.urgentColor;
  else if (message.message_type === 'confidential') typeBorderStyle[isOwn ? 'borderLeftColor' : 'borderRightColor'] = theme.confidentialColor;

  const typeLabel = message.message_type !== 'normal' ? {
    text: message.message_type === 'important' ? 'پیام مهم!' : message.message_type === 'urgent' ? 'پیام اورژانسی!' : 'محرمانه',
    style: { color: message.message_type === 'important' ? theme.importantColor : message.message_type === 'urgent' ? theme.urgentColor : theme.confidentialColor },
    bold: message.message_type === 'urgent',
  } : null;

  const fontSize = theme.fontSize === 'sm' ? '12px' : theme.fontSize === 'lg' ? '16px' : '14px';
  const bubbleRadiusClass = theme.bubbleRadius === 'sharp' ? 'rounded-lg' : theme.bubbleRadius === 'pill' ? 'rounded-3xl' : 'rounded-xl';

  return (
    <>
      {/* Message row — full width on mobile, max 65% on desktop */}
      <div className={`flex ${isOwn ? 'justify-end' : 'justify-start'} mb-2.5 px-3`} dir="rtl">
        <div className={`relative flex items-end gap-2 w-full sm:w-[65%] sm:min-w-[220px] ${isOwn ? 'flex-row-reverse' : 'flex-row'}`}>
          {/* Urgent bell — outside card, above and offset */}
          {message.message_type === 'urgent' && (
            <span className="absolute -top-2.5 z-10 pointer-events-none" style={{ [isOwn ? 'left' : 'right']: '2.5rem' }}>
              <BellRing className="w-5 h-5 text-red-500 drop-shadow-lg animate-bounce" />
            </span>
          )}

          {/* Avatar for received */}
          {!isOwn && (
            <div className="flex-shrink-0 mb-1">
              <UserAvatar name={message.senderProfile?.full_name || 'U'} size="sm" avatarUrl={message.senderProfile?.avatar_url} />
            </div>
          )}
          {/* Avatar for sent */}
          {isOwn && (
            <div className="flex-shrink-0 mb-1">
              <UserAvatar name={message.senderProfile?.full_name || 'U'} size="sm" avatarUrl={message.senderProfile?.avatar_url} />
            </div>
          )}

          {/* Full-width card inside 50% container */}
          <div className="flex-1 flex flex-col">
            {/* Reply preview */}
            {message.replyTarget && (
              <button
                onClick={() => onScrollToMessage?.(message.replyTarget!.id)}
                className="w-full text-right text-xs px-3 py-1.5 rounded-t-xl border-r-2 border-blue-400 bg-blue-50 dark:bg-blue-900/30 text-gray-600 dark:text-gray-300 truncate hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors cursor-pointer"
              >
                {message.replyTarget.body || '📎 فایل'}
              </button>
            )}

            {/* Card — NO overflow-hidden so menus can escape */}
            <div
              className={`relative ${bubbleRadiusClass} ${message.replyTarget ? 'rounded-tr-none' : ''} ${cardBg} shadow-sm border ${borderClass} ${TYPE_BORDER_CLASSES[message.message_type]?.[isOwn ? 'own' : 'other'] ?? ''}`}
              style={{ ...cardStyle, ...typeBorderStyle, fontSize }}
            >

              {/* Header row: sender name + type label + time */}
              <div className={`flex items-center justify-between px-3 pt-2 pb-0.5 gap-2 ${isOwn ? 'flex-row-reverse' : ''}`}>
                <div className={`flex items-center gap-2 min-w-0 ${isOwn ? 'flex-row-reverse' : ''}`}>
                  {!isOwn && message.senderProfile && (
                    <span className="text-xs font-bold text-blue-600 dark:text-blue-400 truncate">
                      {message.senderProfile.full_name || message.senderProfile.email}
                    </span>
                  )}
                  {typeLabel && (
                    <span className="text-[11px] flex-shrink-0 font-semibold" style={typeLabel.style}>{typeLabel.text}</span>
                  )}
                </div>
                <span className="text-[10px] text-gray-400 dark:text-gray-500 flex-shrink-0">{timeStr}</span>
              </div>

              {/* Forwarded indicator */}
              {message.is_forwarded && (
                <div className="flex items-center gap-1.5 px-3 pt-2 pb-0.5">
                  <Forward className="w-3 h-3 text-teal-500 flex-shrink-0" />
                  <span className="text-[11px] text-teal-600 dark:text-teal-400 font-medium truncate">
                    ارسال‌شده از {message.forwarded_from_name || 'کاربر'}
                  </span>
                </div>
              )}

              {/* Body */}
              <div className="px-3 pb-1">
                {message.voice_url && (
                  <div className="flex items-center gap-2 min-w-[150px] py-1">
                    <button onClick={toggleVoice}
                      className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-200 transition-colors">
                      {isPlayingVoice ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                    </button>
                    <div className="flex-1 flex flex-col gap-1">
                      <div className="relative h-1.5 bg-gray-200 dark:bg-gray-600 rounded-full overflow-hidden">
                        <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${voiceProgress * 100}%` }} />
                      </div>
                      <span className="text-[10px] text-gray-400">{message.voice_duration ? formatDuration(message.voice_duration) : '0:00'}</span>
                    </div>
                  </div>
                )}

                {shouldBlur ? (
                  <div className="relative py-1">
                    <p className="text-sm blur-sm select-none pointer-events-none">{message.body}</p>
                    <button onClick={() => setConfidentialRevealed(true)}
                      className="absolute inset-0 flex items-center justify-center gap-1.5 text-xs text-gray-700 dark:text-gray-200 bg-white/80 dark:bg-gray-700/80 rounded-lg backdrop-blur-sm hover:bg-white/95 transition-colors">
                      <Eye className="w-3.5 h-3.5" /> نمایش پیام محرمانه
                    </button>
                  </div>
                ) : message.body && (
                  isDeleted ? (
                    <div className="flex items-center gap-2 py-1 text-xs text-gray-400 dark:text-gray-500 italic">
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>این پیام حذف شده است</span>
                    </div>
                  ) : (
                    <div className="text-sm leading-relaxed py-0.5 break-words">
                      {renderMarkdownBody(message.body, currentUserId, allUsers, (user) => {
                        if (onMentionClick) onMentionClick(user);
                        else setMentionPopupUser(user);
                      })}
                    </div>
                  )
                )}

                {message.file_url && !message.voice_url && (
                  message.file_type === 'image' ? (
                    <a href={message.file_url} target="_blank" rel="noreferrer" className="block mt-1">
                      <img src={message.file_url} alt={message.file_name || 'تصویر'} className="max-w-full rounded-lg max-h-48 object-cover" />
                    </a>
                  ) : (
                    <a href={message.file_url} target="_blank" rel="noreferrer"
                      className="flex items-center gap-2 mt-1 px-2.5 py-2 bg-black/5 dark:bg-white/10 rounded-lg text-xs hover:bg-black/10 transition-colors">
                      <span>📎</span>
                      <span className="truncate max-w-[200px]">{message.file_name || 'فایل'}</span>
                    </a>
                  )
                )}
              </div>

              {/* Bottom action bar */}
              {!isDeleted && (
                <div className={`flex items-center gap-1 px-2 pb-2 pt-1 border-t ${dividerClass} ${isOwn ? 'flex-row-reverse' : ''}`}>
                {/* Status square */}
                <StatusSquare />

                {/* Star */}
                <button onClick={onStar} title={message.isStarred ? 'برداشتن ستاره' : 'نشانه‌دار'} className={`w-7 h-7 flex items-center justify-center rounded-lg transition-colors ${message.isStarred ? 'text-yellow-500' : iconClass}`}>
                  <Star className={`w-4 h-4 ${message.isStarred ? 'fill-yellow-400' : ''}`} />
                </button>

                {/* Tag button + assigned tags (click tag to remove) */}
                <div className="flex items-center gap-1 flex-wrap">
                  <button onClick={() => setShowTagModal(true)} title="تگ" className={`w-7 h-7 flex items-center justify-center rounded-lg transition-colors ${iconClass}`}>
                    <Tag className="w-4 h-4" />
                  </button>
                  {tags.slice(0, 3).map(tag => (
                    <button
                      key={tag.id}
                      onClick={() => removeTag(tag.id)}
                      title="کلیک برای حذف تگ"
                      className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium text-white leading-none hover:opacity-75 transition-opacity group"
                      style={{ backgroundColor: tag.color }}>
                      {tag.name}
                      <X className="w-2.5 h-2.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </button>
                  ))}
                  {tags.length > 3 && <span className="text-[10px] text-gray-400">+{tags.length - 3}</span>}
                </div>

                {/* Full emoji picker */}
                <div ref={reactRef}>
                  <button onClick={openEmojiPicker} title="ایموجی"
                    className={`w-7 h-7 flex items-center justify-center rounded-lg transition-colors ${iconClass}`}>
                    <Smile className="w-4 h-4" />
                  </button>
                  {showReactPicker && (
                    <div style={emojiPickerStyle}>
                      <EmojiPicker
                        onSelect={emoji => { onReact(emoji); setShowReactPicker(false); }}
                        onClose={() => setShowReactPicker(false)}
                      />
                    </div>
                  )}
                </div>

                <div className="flex-1" />

                {/* Eye icon — clickable for own messages to show viewers */}
                {isOwn && (
                  <button
                    onClick={() => setShowViewersModal(true)}
                    className="flex-shrink-0 p-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
                    title={seenByOther ? 'دیده شده — کلیک برای جزئیات' : 'دیده نشده'}
                  >
                    <Eye className={`w-3.5 h-3.5 ${seenByOther ? 'text-emerald-500' : 'text-gray-300 dark:text-gray-600'}`} />
                  </button>
                )}

                {/* Three-dot menu */}
                <div className="relative" ref={menuRef}>
                  <button onClick={() => setShowMenu(v => !v)}
                    className={`w-7 h-7 flex items-center justify-center rounded-lg transition-colors ${iconClass}`}>
                    <MoreVertical className="w-4 h-4" />
                  </button>
                </div>
              </div>
              )}
            </div>

            {/* Reactions below card */}
            {!isDeleted && message.reactions.length > 0 && (
              <div className={`flex flex-wrap gap-1 mt-1 ${isOwn ? 'justify-end' : 'justify-start'}`}>
                {message.reactions.map(r => (
                  <button key={r.emoji} onClick={() => onReact(r.emoji)}
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border transition-colors ${r.reactedByMe ? 'bg-blue-50 dark:bg-blue-900/30 border-blue-300 dark:border-blue-700' : 'bg-white dark:bg-gray-700 border-gray-200 dark:border-gray-600'}`}>
                    {r.emoji} <span className="text-gray-600 dark:text-gray-300">{r.count}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Modals */}
      {mentionPopupUser && (
        <MentionProfilePopup
          user={mentionPopupUser}
          currentUserId={currentUserId}
          onClose={() => setMentionPopupUser(null)}
          onOpenDirectChat={onOpenDirectChat}
        />
      )}
      {showReminderModal && (
        <ReminderModal
          messageId={message.id}
          messageBody={message.body}
          currentUserId={currentUserId}
          onClose={() => setShowReminderModal(false)}
          onSaved={() => { setShowReminderModal(false); onReminderSet(); }}
        />
      )}
      {showTagModal && (
        <TagModal
          messageId={message.id}
          currentTags={tags}
          currentUserId={currentUserId}
          onClose={() => setShowTagModal(false)}
          onChanged={() => { setShowTagModal(false); onTagsChanged(); }}
        />
      )}
      {showForwardModal && (
        <ForwardModal
          body={message.body}
          fileUrl={message.file_url}
          fileName={message.file_name}
          fileType={message.file_type}
          currentUserId={currentUserId}
          allUsers={allUsers}
          senderName={message.senderProfile?.full_name || null}
          onClose={() => setShowForwardModal(false)}
        />
      )}
      {showViewersModal && (
        <ChatViewersModal
          messageId={message.id}
          conversationId={message.conversation_id}
          messageCreatedAt={message.created_at}
          currentUserId={currentUserId}
          allUsers={allUsers}
          readBy={message.read_by || []}
          onClose={() => setShowViewersModal(false)}
        />
      )}

      {/* Three-dot menu — centered modal on mobile, fixed overlay */}
      {showMenu && (
        <div
          className="fixed inset-0 z-[300] flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-[2px]"
          onClick={() => setShowMenu(false)}
          dir="rtl"
        >
          <div
            className="w-full sm:w-64 bg-white dark:bg-gray-900 rounded-t-2xl sm:rounded-2xl shadow-2xl border border-gray-100 dark:border-gray-800 py-2 mb-0 sm:mb-0 overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            {/* Handle bar on mobile */}
            <div className="flex justify-center mb-1 sm:hidden">
              <div className="w-10 h-1 bg-gray-300 dark:bg-gray-600 rounded-full" />
            </div>
            {/* Preview of message */}
            {message.body && (
              <div className="px-4 py-2 mb-1 border-b border-gray-100 dark:border-gray-800">
                <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2">{message.body}</p>
              </div>
            )}
            {onRegisterAsTask && (
              <MI icon={<ClipboardList className="w-4 h-4 text-teal-600 dark:text-teal-400" />}
                label="ثبت در اقدام" labelClass="text-teal-600 dark:text-teal-400 font-medium"
                onClick={() => { onRegisterAsTask(message.body || '', message.id); setShowMenu(false); }} />
            )}
            <MI icon={<Bell className="w-4 h-4" />} label="تنظیم یادآوری"
              onClick={() => { setShowReminderModal(true); setShowMenu(false); }} />
            <MI icon={<Send className="w-4 h-4" />} label="ارسال اعلان پیگیری"
              onClick={() => { sendFollowUp(); setShowMenu(false); }} />
            <MI icon={<Reply className="w-4 h-4" />} label="پاسخ"
              onClick={() => { onReply(); setShowMenu(false); }} />
            <MI icon={<Forward className="w-4 h-4" />} label="ارسال به دیگران (Forward)"
              onClick={() => { setShowForwardModal(true); setShowMenu(false); }} />
            {message.body && (
              <MI icon={<Copy className="w-4 h-4" />} label="کپی متن"
                onClick={() => { navigator.clipboard.writeText(message.body!); toast.success('کپی شد'); setShowMenu(false); }} />
            )}
            {isOwn && (
              <MI icon={<Edit2 className="w-4 h-4" />} label="ویرایش"
                onClick={() => { onEdit(); setShowMenu(false); }} />
            )}
            {hasMentions && (
              <MI icon={<span className="text-teal-500 text-xs font-bold">📅</span>} label="تنظیم جلسه با منشن‌ها"
                labelClass="text-teal-600 dark:text-teal-400 font-medium"
                onClick={() => { onScheduleMeeting(mentionIds, message.body || ''); setShowMenu(false); }} />
            )}
            <div className="border-t border-gray-100 dark:border-gray-800 my-1" />
            <MI icon={<Trash2 className="w-4 h-4 text-red-500" />} label="حذف برای من" labelClass="text-red-500"
              onClick={() => { onDeleteForMe(); setShowMenu(false); }} />
            {isOwn && (
              <MI icon={<Trash2 className="w-4 h-4 text-red-600" />} label="حذف برای همه" labelClass="text-red-600"
                onClick={() => { onDeleteForAll(); setShowMenu(false); }} />
            )}
          </div>
        </div>
      )}
    </>
  );

  async function sendFollowUp() {
    // Send a notification to the other participant
    const conversationId = message.conversation_id;
    const { data: conv } = await supabase
      .from('chat_conversations')
      .select('participant_a, participant_b')
      .eq('id', conversationId)
      .maybeSingle();
    if (!conv) { toast.error('گفتگو یافت نشد'); return; }
    const recipientId = conv.participant_a === currentUserId ? conv.participant_b : conv.participant_a;
    const senderProfile = allUsers.find(u => u.user_id === currentUserId);
    await supabase.rpc('create_notification', {
      p_user_id: recipientId,
      p_title: senderProfile?.full_name || 'پیگیری پیام',
      p_message: `پیگیری: "${(message.body || '').slice(0, 80)}"`,
      p_type: 'chat',
      p_action_url: 'chat',
    });
    toast.success('اعلان پیگیری ارسال شد');
  }
}

// ─── Mention Profile Popup ───────────────────────────────────────────────────
function MentionProfilePopup({ user, currentUserId, onClose, onOpenDirectChat }: {
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
      } catch { /* ignore */ } finally {
        setLoadingPosition(false);
      }
    })();
  }, [user.user_id]);

  const name = user.full_name || user.email || 'کاربر';
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
    <div
      className="fixed inset-0 bg-black/50 z-[500] flex items-center justify-center p-4"
      onClick={onClose}
      dir="rtl"
    >
      <div
        className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex justify-between items-center px-5 pt-4 pb-2 border-b border-gray-100 dark:border-gray-800">
          <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300">پروفایل کاربر</h3>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors">
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>

        {/* Profile card */}
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

        {/* Actions */}
        <div className="px-5 pb-5 pt-1 space-y-2">
          {!isSelf && (
            <button
              onClick={handleDM}
              className="w-full flex items-center gap-3 px-4 py-3 bg-blue-500 hover:bg-blue-600 active:bg-blue-700 text-white rounded-xl transition-colors font-medium"
            >
              <MessageSquare className="w-4 h-4 flex-shrink-0" />
              <span className="text-sm">پیام خصوصی</span>
            </button>
          )}
          <button
            onClick={onClose}
            className="w-full flex items-center justify-center px-4 py-2.5 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-sm"
          >
            بستن
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Reminder Modal ───────────────────────────────────────────────────────────
function ReminderModal({ messageId, messageBody, currentUserId, onClose, onSaved }: {
  messageId: string; messageBody: string | null; currentUserId: string; onClose: () => void; onSaved: () => void;
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
    if (!mins || mins <= 0) { toast.error('زمان یادآوری را انتخاب کنید'); return; }
    setSaving(true);
    const remindAt = new Date(Date.now() + mins * 60 * 1000).toISOString();
    const { error } = await supabase.from('chat_reminders').insert({ message_id: messageId, user_id: currentUserId, remind_at: remindAt, note });
    setSaving(false);
    if (error) { toast.error('خطا در ذخیره یادآوری'); return; }
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
              {presets.map(p => (
                <button key={p.minutes} onClick={() => { setSelectedPreset(p.minutes); setCustomMinutes(''); }}
                  className={`py-2 rounded-xl text-sm font-medium transition-colors border ${selectedPreset === p.minutes ? 'bg-amber-500 text-white border-amber-500' : 'bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:border-amber-300'}`}>
                  {p.label}
                </button>
              ))}
              <input type="number" placeholder="دقیقه دلخواه" value={customMinutes}
                onChange={e => { setCustomMinutes(e.target.value); setSelectedPreset(null); }}
                className="col-span-2 py-2 px-3 rounded-xl text-sm border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 dark:text-white outline-none focus:border-amber-400 text-center" />
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">توضیحات</p>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder="توضیحات اختیاری..."
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-gray-50 dark:bg-gray-800 dark:text-white outline-none focus:border-amber-400 resize-none" />
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

// ─── Tag Modal ────────────────────────────────────────────────────────────────
function TagModal({ messageId, currentTags, currentUserId, onClose, onChanged }: {
  messageId: string; currentTags: ChatTag[]; currentUserId: string; onClose: () => void; onChanged: () => void;
}) {
  const [allTags, setAllTags] = useState<ChatTag[]>([]);
  const [newTagName, setNewTagName] = useState('');
  const [newTagColor, setNewTagColor] = useState('#10B981');
  const [loading, setLoading] = useState(false);
  const TAG_COLORS = ['#10B981', '#3B82F6', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#14B8A6', '#F97316'];

  useEffect(() => {
    supabase.from('chat_tags').select('*').eq('user_id', currentUserId).then(({ data }) => setAllTags(data || []));
  }, [currentUserId]);

  const isAssigned = (tagId: string) => currentTags.some(t => t.id === tagId);

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
    if (error) { toast.error('خطا'); return; }
    if (data) setAllTags(t => [...t, data]);
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
              <button key={tag.id} onClick={() => toggleTag(tag)}
                className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-sm font-medium transition-all border-2 ${isAssigned(tag.id) ? 'text-white border-transparent' : 'border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800'}`}
                style={isAssigned(tag.id) ? { backgroundColor: tag.color } : {}}>
                {isAssigned(tag.id) && <Check className="w-3 h-3" />}{tag.name}
              </button>
            ))}
          </div>
          <div className="border-t border-gray-100 dark:border-gray-800 pt-4">
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">افزودن تگ جدید</p>
            <div className="flex gap-1.5 mb-2">
              {TAG_COLORS.map(c => (
                <button key={c} onClick={() => setNewTagColor(c)}
                  className={`w-6 h-6 rounded-full transition-transform ${newTagColor === c ? 'scale-125 ring-2 ring-offset-1 ring-gray-300' : ''}`}
                  style={{ backgroundColor: c }} />
              ))}
            </div>
            <div className="flex gap-2">
              <input value={newTagName} onChange={e => setNewTagName(e.target.value)} onKeyDown={e => e.key === 'Enter' && addTag()}
                placeholder="نام تگ..." className="flex-1 px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-gray-50 dark:bg-gray-800 dark:text-white outline-none focus:border-blue-400" />
              <button onClick={addTag} disabled={loading} className="px-3 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-xl text-sm font-medium disabled:opacity-50">افزودن</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MI({ icon, label, labelClass, onClick }: { icon: React.ReactNode; label: string; labelClass?: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="w-full flex items-center gap-3 px-4 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors text-right">
      <span className="text-gray-400 dark:text-gray-500 flex-shrink-0">{icon}</span>
      <span className={labelClass || 'text-gray-700 dark:text-gray-300'}>{label}</span>
    </button>
  );
}

function ChatViewersModal({ messageId, conversationId, messageCreatedAt, currentUserId, allUsers, readBy, onClose }: {
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
    // First try the precise per-message log
    supabase
      .from('chat_message_read_log')
      .select('user_id, seen_at')
      .eq('message_id', messageId)
      .then(({ data }) => {
        if (data && data.length > 0) {
          setSeenLog(data.map((r: any) => ({ user_id: r.user_id, seen_at: r.seen_at })));
          setLogLoading(false);
        } else {
          // Fallback: use conversation-level receipts (older messages)
          supabase
            .from('chat_message_read_receipts')
            .select('user_id, last_read_at')
            .eq('conversation_id', conversationId)
            .neq('user_id', currentUserId)
            .gte('last_read_at', messageCreatedAt)
            .then(({ data: fallback }) => {
              setSeenLog((fallback || []).map((r: any) => ({ user_id: r.user_id, seen_at: r.last_read_at })));
              setLogLoading(false);
            });
        }
      });
  }, [messageId]);

  const seenIds = new Set(readBy.filter(id => id !== currentUserId));
  const viewers = [...seenIds].map(uid => {
    const profile = allUsers.find(u => u.user_id === uid);
    const logEntry = seenLog.find(l => l.user_id === uid);
    return { uid, profile, seen_at: logEntry?.seen_at ?? null };
  });

  const formatTime = (iso: string | null) => {
    if (!iso) return null;
    return moment(iso).format('jYYYY/jMM/jDD - HH:mm');
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-[400] flex items-end sm:items-center justify-center p-4" dir="rtl" onClick={onClose}>
      <div className="w-full sm:w-80 bg-white dark:bg-gray-900 rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
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
                      {(profile?.full_name || profile?.email || '?').charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 dark:text-white truncate">
                      {profile?.full_name || profile?.email || 'کاربر'}
                    </p>
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
