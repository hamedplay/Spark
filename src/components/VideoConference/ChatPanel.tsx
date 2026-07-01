import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Send, ImagePlus, MessageSquareOff, MessageSquare, Loader as Loader2, X, ChevronDown } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import moment from 'moment-jalaali';
import toast from 'react-hot-toast';
import type { ConferenceMessage } from './types';

interface Props {
  roomId: string;
  currentUserId: string;
  currentUserName: string;
  messages: ConferenceMessage[];
  chatEnabled: boolean;
  canToggleChat: boolean;
  onToggleChat: () => void;
  sendSignal: (to: string | null, type: string, data: object) => void;
}

interface TypingUser { userId: string; name: string; ts: number; }

// How far from the bottom (px) counts as "near bottom"
const SCROLL_THRESHOLD = 80;

export function ChatPanel({
  roomId, currentUserId, currentUserName,
  messages, chatEnabled, canToggleChat, onToggleChat, sendSignal,
}: Props) {
  const [input, setInput] = useState('');
  const [uploading, setUploading] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [typingUsers, setTypingUsers] = useState<TypingUser[]>([]);
  const [hasUnread, setHasUnread] = useState(false);

  const listRef = useRef<HTMLDivElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingChRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const isNearBottomRef = useRef(true);

  // ── Track scroll position to decide whether to auto-scroll ──────────────────
  const handleScroll = () => {
    const el = listRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isNearBottomRef.current = distFromBottom < SCROLL_THRESHOLD;
    if (isNearBottomRef.current) setHasUnread(false);
  };

  // ── Auto-scroll: only when already near the bottom ───────────────────────────
  useEffect(() => {
    if (isNearBottomRef.current) {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      setHasUnread(false);
    } else {
      setHasUnread(true);
    }
  }, [messages]);

  const scrollToBottom = () => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    setHasUnread(false);
  };

  // ── Typing-indicator channel ─────────────────────────────────────────────────
  useEffect(() => {
    const ch = supabase.channel(`chat-typing-${roomId}`, {
      config: { broadcast: { self: false } },
    })
    .on('broadcast', { event: 'typing' }, ({ payload }) => {
      if (payload.userId === currentUserId) return;
      const now = Date.now();
      if (payload.isTyping) {
        setTypingUsers(prev => {
          const without = prev.filter(u => u.userId !== payload.userId);
          return [...without, { userId: payload.userId, name: payload.name, ts: now }];
        });
      } else {
        setTypingUsers(prev => prev.filter(u => u.userId !== payload.userId));
      }
    })
    .subscribe();

    typingChRef.current = ch;

    // Stale-typing cleanup — remove entries older than 3 s
    const cleaner = setInterval(() => {
      setTypingUsers(prev => prev.filter(u => Date.now() - u.ts < 3000));
    }, 1000);

    return () => {
      // Null out the ref before unsubscribing so broadcastTyping won't fire
      typingChRef.current = null;
      ch.unsubscribe();
      clearInterval(cleaner);
      // Clean up any pending typing timeout
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = null;
      }
    };
  }, [roomId, currentUserId]);

  const broadcastTyping = useCallback((isTyping: boolean) => {
    typingChRef.current?.send({
      type: 'broadcast',
      event: 'typing',
      payload: { userId: currentUserId, name: currentUserName, isTyping },
    });
  }, [currentUserId, currentUserName]);

  // ── Send text message — DB first, then broadcast ─────────────────────────────
  const sendMessage = useCallback(async (imageUrl?: string) => {
    const body = input.trim();
    if (!body && !imageUrl) return;

    broadcastTyping(false);
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }

    const msg: ConferenceMessage = {
      id: crypto.randomUUID(),
      room_id: roomId,
      user_id: currentUserId,
      display_name: currentUserName,
      body: body || '',
      image_url: imageUrl ?? null,
      created_at: new Date().toISOString(),
    };

    // Persist first — if it fails, keep input intact so user can retry
    const { error } = await supabase.from('conference_messages').insert([msg]);
    if (error) {
      toast.error('خطا در ارسال پیام. دوباره تلاش کنید.');
      return;
    }

    // Only clear input and broadcast after successful persist
    setInput('');
    sendSignal(null, 'chat', msg);
  }, [input, roomId, currentUserId, currentUserName, sendSignal, broadcastTyping]);

  // ── Image upload ─────────────────────────────────────────────────────────────
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!e.target) return;
    (e.target as HTMLInputElement).value = '';
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error('فقط فایل‌های تصویری مجاز هستند');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('حجم تصویر نباید بیشتر از ۵ مگابایت باشد');
      return;
    }

    // TODO (security): server-side MIME validation, magic-bytes check, and
    // restricted bucket policy should be configured in Supabase Storage settings
    // to prevent MIME-sniffing bypasses and limit public exposure.
    setUploading(true);
    try {
      const ext = file.name.split('.').pop() || 'jpg';
      const path = `conf-chat/${roomId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from('chat-attachments')
        .upload(path, file, { contentType: file.type, upsert: false });
      if (upErr) throw upErr;
      const { data: { publicUrl } } = supabase.storage.from('chat-attachments').getPublicUrl(path);
      await sendMessage(publicUrl);
    } catch (err: any) {
      toast.error('خطا در آپلود تصویر: ' + (err?.message || ''));
    } finally {
      setUploading(false);
    }
  };

  // ── Input handlers ───────────────────────────────────────────────────────────
  const handleInputChange = (val: string) => {
    setInput(val);
    broadcastTyping(true);
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    // Auto-stop typing signal after 3 s of silence (aligned with cleaner interval)
    typingTimeoutRef.current = setTimeout(() => {
      broadcastTyping(false);
      typingTimeoutRef.current = null;
    }, 3000);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // ── Typing label ─────────────────────────────────────────────────────────────
  const typingLabel = (() => {
    const names = typingUsers.map(u => u.name);
    if (names.length === 0) return null;
    if (names.length === 1) return `${names[0]} در حال تایپ...`;
    if (names.length === 2) return `${names[0]} و ${names[1]} در حال تایپ...`;
    return `${names.length} نفر در حال تایپ...`;
  })();

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <>
      {/* Chat-disabled banner + admin toggle */}
      {(!chatEnabled || canToggleChat) && (
        <div className={`flex items-center justify-between gap-2 px-3 py-2 shrink-0 border-b border-gray-800
          ${chatEnabled ? 'bg-gray-800/40' : 'bg-red-950/40'}`}>
          <div className="flex items-center gap-2 min-w-0">
            {chatEnabled
              ? <MessageSquare className="w-3.5 h-3.5 text-teal-400 shrink-0" aria-hidden="true" />
              : <MessageSquareOff className="w-3.5 h-3.5 text-red-400 shrink-0" aria-hidden="true" />}
            <span className={`text-xs ${chatEnabled ? 'text-gray-400' : 'text-red-400'}`}>
              {chatEnabled ? 'چت فعال است' : 'چت غیرفعال شده'}
            </span>
          </div>
          {canToggleChat && (
            <button
              onClick={onToggleChat}
              aria-label={chatEnabled ? 'غیرفعال کردن چت' : 'فعال کردن چت'}
              className={`text-xs px-2.5 py-1 rounded-lg font-medium transition-colors shrink-0
                ${chatEnabled
                  ? 'bg-red-900/40 hover:bg-red-900/70 text-red-400'
                  : 'bg-teal-900/40 hover:bg-teal-900/70 text-teal-400'}`}
            >
              {chatEnabled ? 'غیرفعال کن' : 'فعال کن'}
            </button>
          )}
        </div>
      )}

      {/* Message list */}
      <div
        ref={listRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-3 space-y-3 min-h-0 relative"
      >
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-gray-600 gap-2 py-8">
            <MessageSquare className="w-8 h-8 opacity-30" aria-hidden="true" />
            <p className="text-xs">هنوز پیامی ارسال نشده</p>
          </div>
        )}
        {messages.map(m => {
          const isOwn = m.user_id === currentUserId;
          return (
            <div key={m.id} className={`flex flex-col gap-0.5 ${isOwn ? 'items-end' : 'items-start'}`}>
              <div className="flex items-center gap-1.5">
                <span className={`text-xs font-semibold ${isOwn ? 'text-teal-400' : 'text-amber-400'}`}>
                  {isOwn ? 'شما' : m.display_name}
                </span>
                <span className="text-gray-600 text-[10px]">{moment(m.created_at).format('HH:mm')}</span>
              </div>

              {/* Image message */}
              {m.image_url && (
                <button
                  onClick={() => setLightboxUrl(m.image_url!)}
                  className={`max-w-[180px] rounded-xl overflow-hidden border transition-opacity hover:opacity-90
                    ${isOwn ? 'border-teal-800' : 'border-gray-700'}`}
                  aria-label="نمایش تصویر بزرگتر"
                >
                  <img
                    src={m.image_url}
                    alt="تصویر ارسالی"
                    className="w-full object-cover max-h-40"
                    loading="lazy"
                  />
                </button>
              )}

              {/* Text body */}
              {m.body && (
                <div className={`text-sm rounded-2xl px-3 py-2 break-words max-w-[200px]
                  ${isOwn
                    ? 'bg-teal-900/60 text-teal-100 rounded-tr-sm'
                    : 'bg-gray-800 text-gray-200 rounded-tl-sm'}`}>
                  {m.body}
                </div>
              )}
            </div>
          );
        })}
        <div ref={chatEndRef} />
      </div>

      {/* New-message indicator when user has scrolled up */}
      {hasUnread && (
        <div className="flex justify-center shrink-0 pb-1 -mt-1">
          <button
            onClick={scrollToBottom}
            aria-label="رفتن به آخرین پیام"
            className="flex items-center gap-1 px-3 py-1 bg-teal-600/90 hover:bg-teal-500 text-white text-xs rounded-full shadow-lg transition-colors"
          >
            <ChevronDown className="w-3 h-3" aria-hidden="true" />
            پیام جدید
          </button>
        </div>
      )}

      {/* Typing indicator */}
      {typingLabel && (
        <div className="px-3 py-1 shrink-0">
          <span className="text-xs text-gray-500 italic flex items-center gap-1.5">
            <span className="flex gap-0.5" aria-hidden="true">
              {[0, 1, 2].map(i => (
                <span key={i} className="w-1 h-1 rounded-full bg-gray-500 animate-bounce"
                  style={{ animationDelay: `${i * 0.15}s` }} />
              ))}
            </span>
            <span aria-live="polite">{typingLabel}</span>
          </span>
        </div>
      )}

      {/* Input area */}
      {chatEnabled ? (
        <div className="p-2 border-t border-gray-800 flex gap-2 shrink-0">
          <input
            value={input}
            onChange={e => handleInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="پیام..."
            aria-label="متن پیام"
            className="flex-1 bg-gray-800 text-white rounded-xl px-3 py-2 text-sm outline-hidden placeholder-gray-500 min-w-0 focus:ring-1 focus:ring-teal-600"
            disabled={uploading}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            aria-label="ارسال تصویر"
            title="ارسال تصویر"
            className="p-2 bg-gray-700 hover:bg-gray-600 rounded-xl transition-colors shrink-0 disabled:opacity-50"
          >
            {uploading
              ? <Loader2 className="w-4 h-4 animate-spin text-teal-400" aria-hidden="true" />
              : <ImagePlus className="w-4 h-4 text-gray-300" aria-hidden="true" />
            }
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileChange}
          />
          <button
            onClick={() => sendMessage()}
            disabled={!input.trim() || uploading}
            aria-label="ارسال پیام"
            className="p-2 bg-teal-600 hover:bg-teal-500 rounded-xl transition-colors shrink-0 disabled:opacity-40"
          >
            <Send className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      ) : (
        <div className="p-3 border-t border-gray-800 shrink-0">
          <p className="text-xs text-gray-600 text-center flex items-center justify-center gap-1.5">
            <MessageSquareOff className="w-3.5 h-3.5" aria-hidden="true" />
            چت توسط میزبان غیرفعال شده است
          </p>
        </div>
      )}

      {/* Image lightbox */}
      {lightboxUrl && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="نمایش تصویر"
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/85 backdrop-blur-xs p-4"
          onClick={() => setLightboxUrl(null)}
        >
          <button
            onClick={() => setLightboxUrl(null)}
            aria-label="بستن نمایش تصویر"
            className="absolute top-4 left-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
          <img
            src={lightboxUrl}
            alt="تصویر بزرگ"
            className="max-w-full max-h-[90vh] rounded-xl object-contain shadow-2xl"
            onClick={e => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}
