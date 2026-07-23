import { useState, useEffect, useRef } from 'react';
import { UserPlus, X, Plus } from 'lucide-react';
import type { ContactEmail } from '../../../../types';

export interface ExternalContactDraft {
  name: string;
  email: string;
  phone: string;
}

export interface ExternalParticipantsFieldProps {
  contacts: ContactEmail[];
  selectedNames: string[];

  draft: ExternalContactDraft;
  isAddFormOpen: boolean;

  onSelect: (name: string) => void;
  onRemove: (name: string) => void;

  onDraftChange: (draft: ExternalContactDraft) => void;
  onAddFormOpenChange: (open: boolean) => void;
  onAddContact: () => void | Promise<void>;
}

export function ExternalParticipantsField({
  contacts,
  selectedNames,
  draft,
  isAddFormOpen,
  onSelect,
  onRemove,
  onDraftChange,
  onAddFormOpenChange,
  onAddContact,
}: ExternalParticipantsFieldProps) {
  const [externalSearch, setExternalSearch] = useState('');
  const [showExternalDropdown, setShowExternalDropdown] = useState(false);
  const externalSearchRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (externalSearchRef.current && !externalSearchRef.current.contains(e.target as Node)) setShowExternalDropdown(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filteredContacts = contacts.filter(c =>
    c.name.toLowerCase().includes(externalSearch.toLowerCase()) ||
    (c.email ?? '').toLowerCase().includes(externalSearch.toLowerCase())
  ).filter(c => !selectedNames.includes(c.name));

  return (
    <div className="mt-5" ref={externalSearchRef}>
      <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
        <UserPlus className="w-4 h-4" />افراد خارج سازمان
      </label>
      <div
        className="flex flex-wrap gap-1.5 p-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 cursor-text min-h-[42px]"
        onClick={() => setShowExternalDropdown(true)}
      >
        {selectedNames.map(name => (
          <span key={name} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300">
            {name}
            <button type="button" onClick={e => { e.stopPropagation(); onRemove(name); }} className="hover:opacity-70">
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
        <input
          type="text"
          value={externalSearch}
          onChange={e => { setExternalSearch(e.target.value); setShowExternalDropdown(true); }}
          onFocus={() => setShowExternalDropdown(true)}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (filteredContacts.length > 0) {
                onSelect(filteredContacts[0].name);
                setExternalSearch('');
                setShowExternalDropdown(false);
              }
            } else if (e.key === 'Escape') {
              setShowExternalDropdown(false);
            }
          }}
          placeholder={selectedNames.length === 0 ? 'جستجوی مخاطبین خارج سازمان...' : ''}
          className="flex-1 min-w-[120px] outline-none bg-transparent text-sm dark:text-white placeholder-gray-400"
        />
      </div>
      {showExternalDropdown && (
        <div className="relative z-20">
          <div className="absolute w-full mt-1 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg max-h-44 overflow-y-auto">
            {filteredContacts.slice(0, 8).map(c => (
              <button key={c.id} type="button"
                onClick={() => { onSelect(c.name); setExternalSearch(''); setShowExternalDropdown(false); }}
                className="w-full text-right px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-600 text-sm dark:text-white flex items-center justify-between border-b border-gray-50 dark:border-gray-600 last:border-0">
                <span>{c.name}</span><span className="text-xs text-gray-400">{c.email}</span>
              </button>
            ))}
            {(externalSearch || filteredContacts.length === 0) && (
              <button type="button" onClick={() => { onAddFormOpenChange(true); setShowExternalDropdown(false); }}
                className="w-full text-right px-3 py-2 hover:bg-green-50 dark:hover:bg-green-900/20 text-sm text-green-600 flex items-center gap-2 border-t border-gray-200 dark:border-gray-600">
                <Plus className="w-4 h-4" />افزودن مخاطب جدید
              </button>
            )}
            {filteredContacts.length === 0 && !externalSearch && (
              <div className="p-3 text-sm text-gray-400">مخاطبی یافت نشد</div>
            )}
          </div>
        </div>
      )}
      {isAddFormOpen && (
        <div className="mt-2 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg border border-gray-200 dark:border-gray-600">
          <div className="space-y-2 mb-2">
            <input type="text" value={draft.name} onChange={(e) => onDraftChange({ ...draft, name: e.target.value })}
              className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white text-sm" placeholder="نام مخاطب" />
            <div className="flex gap-2">
              <input type="tel" value={draft.phone} onChange={(e) => onDraftChange({ ...draft, phone: e.target.value })}
                className="flex-1 p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white text-sm" placeholder="شماره موبایل" />
              <input type="email" value={draft.email} onChange={(e) => onDraftChange({ ...draft, email: e.target.value })}
                className="flex-1 p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white text-sm" placeholder="ایمیل (اختیاری)" />
            </div>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onAddContact} className="px-3 py-1.5 bg-green-500 text-white rounded-lg text-sm hover:bg-green-600">ذخیره و افزودن</button>
            <button type="button" onClick={() => { onAddFormOpenChange(false); onDraftChange({ name: '', email: '', phone: '' }); }} className="px-3 py-1.5 bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg text-sm hover:bg-gray-300">انصراف</button>
          </div>
        </div>
      )}
    </div>
  );
}
