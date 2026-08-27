import type { ConferenceReactionEvent } from '../../types/conference.types';

function reactionInitial(name: string): string {
  return name.trim().slice(0, 1) || '؟';
}

export function ReactionOverlay({
  reactions,
}: {
  reactions: ConferenceReactionEvent[];
}) {
  if (reactions.length === 0) return null;

  return (
    <div
      className="pointer-events-none absolute inset-x-2 bottom-24 z-30 flex flex-wrap items-end justify-center gap-2 sm:inset-x-8"
      aria-live="polite"
      aria-label="واکنش‌های شرکت‌کنندگان"
    >
      {reactions.map((event) => (
        <div
          key={event.id}
          className="motion-safe:animate-bounce flex max-w-[220px] items-center gap-2 rounded-full border border-white/15 bg-slate-900/90 px-2.5 py-1.5 shadow-xl backdrop-blur"
          title={new Date(event.timestamp).toLocaleString('fa-IR')}
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-700">
            {event.avatarUrl ? (
              <img
                src={event.avatarUrl}
                alt=""
                className="h-full w-full object-cover"
                referrerPolicy="no-referrer"
              />
            ) : (
              <span className="text-xs font-bold text-white" aria-hidden="true">
                {reactionInitial(event.displayName)}
              </span>
            )}
          </div>
          <div className="min-w-0">
            <div className="truncate text-[10px] font-semibold text-slate-200">
              {event.displayName}
            </div>
            <div className="text-2xl leading-none" aria-label={`واکنش ${event.reaction}`}>
              {event.reaction}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
