export function ReactionOverlay({ reaction }: { reaction: string | null }) {
  if (!reaction) return null;
  return <div className="pointer-events-none absolute inset-x-0 top-24 text-center text-6xl" aria-live="polite">{reaction}</div>;
}
