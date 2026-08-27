import { useEffect, useRef } from 'react';
import { ShieldCheck } from 'lucide-react';
import type { ConferenceModeratorMessageRow } from '../../types/conference.types';
import { ConferenceModeratorChatComposer } from './ConferenceModeratorChatComposer';
import { ConferenceModeratorMessageItem } from './ConferenceModeratorMessageItem';

interface Props {
  messages: ConferenceModeratorMessageRow[];
  currentUserId: string;
  message: string;
  canSend: boolean;
  busy: boolean;
  errorMessage: string;
  replyTo: ConferenceModeratorMessageRow | null;
  editing: ConferenceModeratorMessageRow | null;
  onMessageChange: (value: string) => void;
  onSend: () => Promise<void>;
  onReply: (item: ConferenceModeratorMessageRow) => void;
  onEdit: (item: ConferenceModeratorMessageRow) => void;
  onDelete: (item: ConferenceModeratorMessageRow) => Promise<void>;
  onCancelContext: () => void;
}

export function ConferenceModeratorChatPanel({
  messages,
  currentUserId,
  message,
  canSend,
  busy,
  errorMessage,
  replyTo,
  editing,
  onMessageChange,
  onSend,
  onReply,
  onEdit,
  onDelete,
  onCancelContext,
}: Props) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' });
  }, [messages.length]);

  return (
    <div className="flex max-h-[48dvh] flex-col">
      <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2 text-[10px] text-amber-200">
        <ShieldCheck className="h-3.5 w-3.5" />
        این کانال فقط برای میزبان، هم‌میزبان و مدیر جلسه قابل مشاهده است.
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {messages.length === 0 && (
          <p className="py-8 text-center text-xs text-slate-400">
            هنوز پیامی در کانال مدیران ارسال نشده است.
          </p>
        )}

        {messages.map((item) => (
          <ConferenceModeratorMessageItem
            key={item.id}
            item={item}
            currentUserId={currentUserId}
            busy={busy}
            onReply={onReply}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        ))}
        <div ref={endRef} />
      </div>

      <ConferenceModeratorChatComposer
        message={message}
        canSend={canSend}
        busy={busy}
        errorMessage={errorMessage}
        replyTo={replyTo}
        editing={editing}
        onMessageChange={onMessageChange}
        onSend={onSend}
        onCancelContext={onCancelContext}
      />
    </div>
  );
}
