import { BookUser } from 'lucide-react';
import type { ContactEmail } from '../../types';

export function RepresentativeField(props: {
  repPickerRef: React.RefObject<HTMLDivElement | null>;
  representative: string;
  setRepresentative: (v: string) => void;
  setRepFromContacts: (v: boolean) => void;
  showRepPicker: boolean;
  setShowRepPicker: (v: boolean) => void;
  setRepPickerSearch: (v: string) => void;
  repPickerSearch: string;
  allContacts: ContactEmail[];
  setPhone: (v: string) => void;
  phone: string;
}) {
  const {
    repPickerRef, representative, setRepresentative, setRepFromContacts,
    showRepPicker, setShowRepPicker, setRepPickerSearch, repPickerSearch,
    allContacts, setPhone,
  } = props;

  return (
    <div className="relative" ref={repPickerRef}>
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">نماینده</label>
      <div className="relative">
        <input required type="text" value={representative}
          onChange={e => { setRepresentative(e.target.value); setRepFromContacts(false); }}
          className="w-full p-2 pl-9 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white" />
        <button type="button" onClick={() => { setShowRepPicker(!showRepPicker); setRepPickerSearch(''); }}
          className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-blue-600 transition-colors"
          title="انتخاب از مخاطبین">
          <BookUser className="w-4 h-4" />
        </button>
      </div>
      {showRepPicker && (
        <div className="absolute z-30 left-0 right-0 top-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-xl shadow-xl">
          <div className="p-2 border-b border-gray-100 dark:border-gray-700">
            <input autoFocus type="text" value={repPickerSearch} onChange={e => setRepPickerSearch(e.target.value)}
              placeholder="جستجو در مخاطبین..."
              className="w-full px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="max-h-48 overflow-y-auto">
            {allContacts.filter(c => c.name.toLowerCase().includes(repPickerSearch.toLowerCase()) || ((c as any).phone || '').includes(repPickerSearch)).length === 0
              ? <div className="p-3 text-sm text-gray-400 text-center">مخاطبی یافت نشد</div>
              : allContacts.filter(c => c.name.toLowerCase().includes(repPickerSearch.toLowerCase()) || ((c as any).phone || '').includes(repPickerSearch)).map(c => (
                <button key={c.id} type="button"
                  onClick={() => { setRepresentative(c.name); setPhone((c as any).phone || ''); setRepFromContacts(true); setShowRepPicker(false); }}
                  className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700 text-sm transition-colors">
                  <span className="font-medium dark:text-white">{c.name}</span>
                  {(c as any).phone && <span className="text-xs text-gray-400 ltr">{(c as any).phone}</span>}
                </button>
              ))
            }
          </div>
        </div>
      )}
    </div>
  );
}
