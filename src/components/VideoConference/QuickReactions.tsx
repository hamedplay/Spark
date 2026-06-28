import React, { useState } from 'react';

const QUICK_EMOJIS = ['👍', '👏', '😂', '❤️', '🎉'] as const;

interface Props {
  onSend: (emoji: string) => void;
}

export function QuickReactions({ onSend }: Props) {
  const [pressed, setPressed] = useState<string | null>(null);

  const handleClick = (emoji: string) => {
    onSend(emoji);
    setPressed(emoji);
    setTimeout(() => setPressed(null), 400);
  };

  return (
    <div
      className="flex items-center gap-1.5 bg-gray-900/80 backdrop-blur-sm rounded-2xl px-2.5 py-1.5 border border-gray-700/50 shadow-xl"
      role="toolbar"
      aria-label="واکنش سریع"
    >
      {QUICK_EMOJIS.map(emoji => (
        <button
          key={emoji}
          onClick={() => handleClick(emoji)}
          aria-label={`واکنش ${emoji}`}
          className={`w-9 h-9 flex items-center justify-center rounded-xl text-xl transition-all duration-150
            hover:bg-gray-700/70 active:scale-90
            ${pressed === emoji ? 'scale-125 bg-gray-700/70' : 'scale-100'}`}
          style={{
            transition: pressed === emoji
              ? 'transform 0.12s cubic-bezier(.34,1.56,.64,1)'
              : 'transform 0.15s ease, background-color 0.15s ease',
          }}
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}
