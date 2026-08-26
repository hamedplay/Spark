import { ScreenShare, X } from 'lucide-react';

export function ScreenShareBadge({ userName, onStop }: { userName: string; onStop: () => void }) {
  return (
    <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 bg-teal-600/95 rounded-full px-4 py-1.5 flex items-center gap-2 text-sm font-medium text-white shadow-lg">
      <ScreenShare className="w-4 h-4" />
      {userName} در حال ارائه صفحه است
      <button onClick={onStop} className="mr-1 px-2 py-0.5 rounded-full bg-white/20 hover:bg-white/30 text-xs transition-colors">
        توقف
      </button>
    </div>
  );
}

export function FloatingReactions({ reactions }: { reactions: Array<{ id: string; x: number; y: number; emoji: string; displayName: string }> }) {
  return (
    <>
      {reactions.map(r => (
        <div key={r.id} className="fixed pointer-events-none z-[9999] flex flex-col items-center gap-0.5"
          style={{ left: `${r.x}%`, top: `${r.y}%`, animation: 'float-up 3s ease-out forwards' }}>
          <span className="text-3xl">{r.emoji}</span>
          <span className="text-[10px] text-white/80 bg-black/50 rounded-full px-1.5 py-0.5 leading-tight max-w-[72px] truncate">{r.displayName}</span>
        </div>
      ))}
    </>
  );
}

export function EmojiPicker({ emojis, onPick, onClose }: { emojis: string[]; onPick: (e: string) => void; onClose?: () => void }) {
  return (
    <div role="listbox" aria-label="انتخاب ایموجی"
      className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 bg-gray-800 rounded-2xl p-2 flex flex-wrap gap-1 shadow-2xl border border-gray-700 z-[200] w-52">
      {emojis.map(e => (
        <button key={e} onClick={() => onPick(e)} aria-label={`واکنش ${e}`}
          className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-gray-700 text-lg transition-colors">
          {e}
        </button>
      ))}
    </div>
  );
}

export function SpeakingProgressBar({ speakingSecs, limitSecs }: { speakingSecs: number; limitSecs: number }) {
  return (
    <div className="absolute top-0 left-0 right-0 h-0.5 bg-gray-800">
      <div
        className={`h-full transition-all duration-500 ${speakingSecs >= limitSecs * 0.83 ? 'bg-red-500' : speakingSecs >= limitSecs * 0.5 ? 'bg-amber-400' : 'bg-teal-400'}`}
        style={{ width: `${Math.min((speakingSecs / limitSecs) * 100, 100)}%` }}
      />
    </div>
  );
}
