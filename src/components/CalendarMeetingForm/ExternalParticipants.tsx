import { UserPlus, X, Plus } from 'lucide-react';
import type { ContactEmail } from '../../types';

export function ExternalParticipants(props: {
  externalSearchRef: React.RefObject<HTMLDivElement | null>;
  externalSearch: string;
  setExternalSearch: (v: string) => void;
  showExternalDropdown: boolean;
  setShowExternalDropdown: (v: boolean) => void;
  selectedExternal: string[];
  setSelectedExternal: React.Dispatch<React.SetStateAction<string[]>>;
  filteredExternal: { id: string; name: string; sub?: string }[];
  showAddExternal: boolean;
  setShowAddExternal: (v: boolean) => void;
  newExternalName: string;
  setNewExternalName: (v: string) => void;
  newExternalEmail: string;
  setNewExternalEmail: (v: string) => void;
  newExternalPhone: string;
  setNewExternalPhone: (v: string) => void;
  addQuickExternal: () => void;
}) {
  const {
    externalSearchRef, externalSearch, setExternalSearch, showExternalDropdown, setShowExternalDropdown,
    selectedExternal, setSelectedExternal, filteredExternal,
    showAddExternal, setShowAddExternal, newExternalName, setNewExternalName,
    newExternalEmail, setNewExternalEmail, newExternalPhone, setNewExternalPhone, addQuickExternal,
  } = props;

  return (
    <div ref={externalSearchRef}>
      <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
        <UserPlus className="w-4 h-4" />افراد خارج سازمان
      </label>
      <div
        className="flex flex-wrap gap-1.5 p-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 cursor-text min-h-[42px]"
        onClick={() => setShowExternalDropdown(true)}
      >
        {selectedExternal.map(name => (
          <span key={name} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300">
            {name}
            <button type="button" onClick={e => { e.stopPropagation(); setSelectedExternal(prev => prev.filter(x => x !== name)); }} className="hover:opacity-70">
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
              if (filteredExternal.length > 0) {
                setSelectedExternal(prev => [...prev, filteredExternal[0].name]);
                setExternalSearch('');
                setShowExternalDropdown(false);
              }
            } else if (e.key === 'Escape') {
              setShowExternalDropdown(false);
            }
          }}
          placeholder={selectedExternal.length === 0 ? 'جستجوی مخاطبین...' : ''}
          className="flex-1 min-w-[120px] outline-none bg-transparent text-sm dark:text-white placeholder-gray-400"
        />
      </div>
      {showExternalDropdown && (
        <div className="relative z-20">
          <div className="absolute w-full mt-1 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg max-h-44 overflow-y-auto">
            {filteredExternal.slice(0, 8).map(c => (
              <button key={c.id} type="button"
                onClick={() => { setSelectedExternal(prev => [...prev, c.name]); setExternalSearch(''); setShowExternalDropdown(false); }}
                className="w-full text-right px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-600 text-sm dark:text-white flex items-center justify-between border-b border-gray-50 dark:border-gray-600 last:border-0">
                <span>{c.name}</span><span className="text-xs text-gray-400">{c.sub}</span>
              </button>
            ))}
            {externalSearch && (
              <button type="button" onClick={() => { setShowAddExternal(true); setShowExternalDropdown(false); }}
                className="w-full text-right px-3 py-2 hover:bg-green-50 dark:hover:bg-green-900/20 text-sm text-green-600 flex items-center gap-2 border-t border-gray-200 dark:border-gray-600">
                <Plus className="w-4 h-4" />افزودن مخاطب جدید
              </button>
            )}
            {filteredExternal.length === 0 && !externalSearch && (
              <div className="p-3 text-sm text-gray-400">مخاطبی یافت نشد</div>
            )}
          </div>
        </div>
      )}
      {showAddExternal && (
        <div className="mt-2 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg border border-gray-200 dark:border-gray-600">
          <div className="space-y-2 mb-2">
            <input type="text" value={newExternalName} onChange={e => setNewExternalName(e.target.value)}
              className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white text-sm" placeholder="نام مخاطب" />
            <div className="flex gap-2">
              <input type="tel" value={newExternalPhone} onChange={e => setNewExternalPhone(e.target.value)}
                className="flex-1 p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white text-sm" placeholder="شماره موبایل" />
              <input type="email" value={newExternalEmail} onChange={e => setNewExternalEmail(e.target.value)}
                className="flex-1 p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white text-sm" placeholder="ایمیل (اختیاری)" />
            </div>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={addQuickExternal} className="px-3 py-1.5 bg-green-500 text-white rounded-lg text-sm hover:bg-green-600">ذخیره و افزودن</button>
            <button type="button" onClick={() => { setShowAddExternal(false); setNewExternalName(''); setNewExternalEmail(''); setNewExternalPhone(''); }} className="px-3 py-1.5 bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg text-sm">انصراف</button>
          </div>
        </div>
      )}
    </div>
  );
}
