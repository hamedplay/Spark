import { useEffect, useRef } from 'react';
import { LockKeyhole } from 'lucide-react';
import type {
  ConferencePrivateMessageRow,
  ParticipantRow,
} from '../../types/conference.types';
import { ConferencePrivateChatComposer } from './ConferencePrivateChatComposer';
import { ConferencePrivateMessageItem } from './ConferencePrivateMessageItem';

interface Props {
  conversation: ConferencePrivateMessageRow[];
  peers: ParticipantRow[];
  selectedPeerUserId: string | null;
  unreadByPeer: Record<string, number>;
  currentUserId: string;
  message: string;
  canSend: boolean;
  busy: boolean;
  errorMessage: string;
  replyTo: ConferencePrivateMessageRow | null;
  editing: ConferencePrivateMessageRow | null;
  onSelectPeer: (userId: string) => void;
  onMessageChange: (value: string) => void;
  onSend: () => Promise<void>;
  onReply: (item: ConferencePrivateMessageRow) => void;
  onEdit: (item: ConferencePrivateMessageRow) => void;
  onDelete: (item: ConferencePrivateMessageRow) => Promise<void>;
  onCancelContext: () => void;
}

export function ConferencePrivateChatPanel({
  conversation,
  peers,
  selectedPeerUserId,
  unreadByPeer,
  currentUserId,
  message,
  canSend,
  busy,
  errorMessage,
  replyTo,
  editing,
  onSelectPeer,
  onMessageChange,
  onSend,
  onReply,
  onEdit,
  onDelete,
  onCancelContext,
}: Props) {
  const endRef = useRef<HTMLDivElement>(null);
  const selectedPeer = peers.find((peer) => peer.user_id === selectedPeerUserId);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' });
  }, [conversation.length, selectedPeerUserId]);

  return (
    <div className="flex max-h-[48dvh] flex-col">
      <div className="border-b border-white/10 p-2">
        <div className="mb-2 flex items-center gap-1.5 text-[10px] text-slate-400">
          <LockKeyhole className="h-3 w-3" />
          پیام‌ها فقط برای شما و مخاطب انتخاب‌شده قابل خواندن هستند.
        </div>

        <div className="flex gap-1 overflow-x-auto pb-1">
          {peers.length === 0 && (
            <div className="px-2 py-2 text-[10px] text-slate-500">
              شرکت‌کننده دیگری در جلسه نیست.
            </div>
          )}
          {peers.map((peer) => {
            const selected = peer.user_id === selectedPeerUserId;
            const unread = unreadByPeer[peer.user_id] || 0;
            return (
              <button
                key={peer.user_id}
                type="button"
                onClick={() => onSelectPeer(peer.user_id)}
                className={`relative shrink-0 rounded-xl border px-3 py-2 text-[10px] ${
                  selected
                    ? 'border-violet-400 bg-violet-500/20 text-violet-100'
                    : 'border-white/10 bg-slate-900 text-slate-300'
                }`}
              >
                {peer.display_name || 'شرکت‌کننده'}
                {unread > 0 && (
                  <span className="absolute -left-1 -top-1 min-w-4 rounded-full bg-rose-500 px-1 text-[8px] text-white">
                    {unread > 99 ? '99+' : unread}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {selectedPeer && conversation.length === 0 && (
          <p className="py-8 text-center text-xs text-slate-400">
            هنوز پیام خصوصی با {selectedPeer.display_name || 'این کاربر'} ندارید.
          </p>
        )}
        {!selectedPeer && (
          <p className="py-8 text-center text-xs text-slate-400">
            یک مخاطب را انتخاب کنید.
          </p>
        )}

        {conversation.map((item) => (
          <ConferencePrivateMessageItem
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

      <ConferencePrivateChatComposer
        message={message}
        canSend={canSend}
        busy={busy}
        errorMessage={errorMessage}
        replyTo={replyTo}
        editing={editing}
        hasPeer={Boolean(selectedPeer)}
        onMessageChange={onMessageChange}
        onSend={onSend}
        onCancelContext={onCancelContext}
      />
    </div>
  );
}
