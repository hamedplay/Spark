import type { ReactNode } from 'react';

interface MutableCurrent<T> { current: T }
export function pushEditorHistory(historyRef: MutableCurrent<string[]>, historyIndexRef: MutableCurrent<number>, value: string) {
  const history = historyRef.current.slice(0, historyIndexRef.current + 1);
  if (history[history.length - 1] !== value) {
    history.push(value);
    if (history.length > 50) history.shift();
    historyRef.current = history;
    historyIndexRef.current = history.length - 1;
  }
}

export function updateMessageBody(value: string, setBody: (value: string) => void, pushHistory: (value: string) => void, setShowMentionMenu: (value: boolean) => void, setMentionSearch: (value: string) => void) {
  setBody(value);
  pushHistory(value);
  const lastAt = value.lastIndexOf('@');
  if (lastAt >= 0 && (lastAt === value.length - 1 || value.slice(lastAt + 1).match(/^\w*$/))) {
    setShowMentionMenu(true);
    setMentionSearch(value.slice(lastAt + 1));
  } else {
    setShowMentionMenu(false);
  }
}

interface MessageTypeOption<K extends string> { key: K; label: string; icon: ReactNode; color: string; desc: string }
export function MessageTypeOptionButton<K extends string>({ option, selected, onSelect, onClose }: { option: MessageTypeOption<K>; selected: K; onSelect: (key: K) => void; onClose: () => void }) {
  return (
    <button type="button" key={option.key} onClick={() => { onSelect(option.key); onClose(); }} className={`w-full flex items-start gap-2.5 px-3 py-2.5 text-right hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors ${selected === option.key ? 'bg-gray-50 dark:bg-gray-700/30' : ''}`}>
      <span className={`mt-0.5 ${option.color}`}>{option.icon}</span>
      <span>
        <span className="block text-sm text-gray-800 dark:text-gray-200">{option.label}</span>
        {option.desc && <span className="block text-[10px] text-gray-400 mt-0.5">{option.desc}</span>}
      </span>
    </button>
  );
}
