import { useEffect, useRef } from 'react';
import type {
  ConferenceMessageRow,
  ParticipantRow,
} from '../../types/conference.types';
import { ConferenceChatComposer } from './ConferenceChatComposer';
import { ConferenceMessageItem } from './ConferenceMessageItem';

interface Props {
  messages: ConferenceMessageRow[];
  message: string;
  currentUserId: string;
  canSend: boolean;
  canDeleteAny: boolean;
  busy: boolean;
  errorMessage: string;
  replyTo: ConferenceMessageRow | null;
  editing: ConferenceMessageRow | null;
  mentionCandidates: ParticipantRow[];
  selectedMentionUserIds: string[];
  onMessageChange: (value: string) => void;
  onSend: () => Promise<void>;
  onReply: (item: ConferenceMessageRow) => void;
  onEdit: (item: ConferenceMessageRow) => void;
  onDelete: (item: ConferenceMessageRow) => Promise<void>;
  onReact: (item: ConferenceMessageRow, emoji: string) => Promise<void>;
  onCancelContext: () => void;
  onToggleMention: (participant: ParticipantRow) => void;
}

export function ConferenceChatPanel({
  messages,
  message,
  currentUserId,
  canSend,
  canDeleteAny,
  busy,
  errorMessage,
  replyTo,
  editing,
  mentionCandidates,
  selectedMentionUserIds,
  onMessageChange,
  onSend,
  onReply,
  onEdit,
  onDelete,
  onReact,
  onCancelContext,
  onToggleMention,
}: Props) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' });
  }, [messages.length]);

  return (
    <div className="flex max-h-[48dvh] flex-col">
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {messages.length === 0 && (
          <p className="py-8 text-center text-xs text-slate-400">
            هنوز پیامی ارسال نشده است.
          </p>
        )}

        {messages.map((item) => (
          <ConferenceMessageItem
            key={item.id}
            item={item}
            currentUserId={currentUserId}
            canInteract={canSend}
            canDeleteAny={canDeleteAny}
            busy={busy}
            onReply={onReply}
            onEdit={onEdit}
            onDelete={onDelete}
            onReact={onReact}
          />
        ))}
        <div ref={endRef} />
      </div>

      <ConferenceChatComposer
        message={message}
        canSend={canSend}
        busy={busy}
        errorMessage={errorMessage}
        replyTo={replyTo}
        editing={editing}
        mentionCandidates={mentionCandidates}
        selectedMentionUserIds={selectedMentionUserIds}
        onMessageChange={onMessageChange}
        onSend={onSend}
        onCancelContext={onCancelContext}
        onToggleMention={onToggleMention}
      />
    </div>
  );
}
