import type { Dispatch, KeyboardEvent, SetStateAction } from 'react';

export interface MultiSelectKeyboardItem {
  id: string;
  name: string;
}

interface MultiSelectKeyboardContext<T extends MultiSelectKeyboardItem> {
  open: boolean;
  filtered: T[];
  highlightedIndex: number;
  onAdd: (item: MultiSelectKeyboardItem) => void;
  setQuery: Dispatch<SetStateAction<string>>;
  setOpen: Dispatch<SetStateAction<boolean>>;
  setHighlightedIndex: Dispatch<SetStateAction<number>>;
}

export function handleMultiSelectKeyDown<T extends MultiSelectKeyboardItem>(event: KeyboardEvent, context: MultiSelectKeyboardContext<T>) {
  const { open, filtered, highlightedIndex, onAdd, setQuery, setOpen, setHighlightedIndex } = context;
  if (event.key === 'Enter') {
    event.preventDefault();
    if (open && filtered.length > 0) {
      const item = filtered[highlightedIndex] || filtered[0];
      onAdd({ id: item.id, name: item.name });
      setQuery('');
      setHighlightedIndex(0);
    }
  } else if (event.key === 'ArrowDown') {
    event.preventDefault();
    setOpen(true);
    setHighlightedIndex(index => Math.min(index + 1, filtered.length - 1));
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    setHighlightedIndex(index => Math.max(index - 1, 0));
  } else if (event.key === 'Escape') {
    setOpen(false);
  }
}
