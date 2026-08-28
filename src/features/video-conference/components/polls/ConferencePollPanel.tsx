import { useState } from 'react';
import { BarChart3, Loader2, Plus, X } from 'lucide-react';
import { useConferenceClient } from '../../../../components/VideoConference/conferenceClient';
import { useConferencePolls } from '../../hooks/useConferencePolls';
import type { ConferenceAuthorization } from '../../types/conference.types';
import { PollCard } from './PollCard';
import { PollCreateForm } from './PollCreateForm';

interface Props {
  roomId: string;
  currentUserId: string;
  authorization: ConferenceAuthorization;
}

export function ConferencePollPanel({
  roomId,
  currentUserId,
  authorization,
}: Props) {
  const client = useConferenceClient();
  const polls = useConferencePolls({
    client,
    roomId,
    currentUserId,
    authorization,
  });
  const [showCreate, setShowCreate] = useState(false);

  if (!polls.loaded) {
    return (
      <div className="flex min-h-40 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-cyan-400" />
      </div>
    );
  }

  return (
    <div className="max-h-[52dvh] space-y-3 overflow-y-auto p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-slate-300">
          <BarChart3 className="h-4 w-4 text-cyan-300" />
          {polls.openCount} نظرسنجی باز
        </div>
        {polls.canCreate && (
          <button
            type="button"
            onClick={() => setShowCreate((current) => !current)}
            className="flex items-center gap-1 rounded-lg bg-cyan-950 px-2 py-1.5 text-[10px] text-cyan-200"
          >
            {showCreate ? <X className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
            {showCreate ? 'بستن فرم' : 'نظرسنجی جدید'}
          </button>
        )}
      </div>

      {showCreate && polls.canCreate && (
        <PollCreateForm
          busy={polls.busy === 'create'}
          errorMessage={polls.errorMessage}
          onCreate={polls.createPoll}
        />
      )}

      {!showCreate && polls.errorMessage && (
        <p className="rounded-lg bg-rose-950/60 px-3 py-2 text-[10px] text-rose-200">
          {polls.errorMessage}
        </p>
      )}

      {polls.polls.length === 0 ? (
        <p className="py-8 text-center text-xs text-slate-400">
          هنوز نظرسنجی‌ای برای این جلسه ثبت نشده است.
        </p>
      ) : (
        polls.polls.map((poll) => (
          <PollCard
            key={poll.id}
            poll={poll}
            busy={polls.busy}
            onVote={polls.votePoll}
            onOpen={polls.openPoll}
            onClose={polls.closePoll}
            onDelete={polls.deletePoll}
          />
        ))
      )}
    </div>
  );
}
