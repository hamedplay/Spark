import { BookUser } from 'lucide-react';
import type { ContactEmail } from '../../types';

export function CoreFieldsSection(props: {
  subject: string;
  setSubject: React.Dispatch<React.SetStateAction<string>>;
  location: string;
  setLocation: React.Dispatch<React.SetStateAction<string>>;
  representative: string;
  setRepresentative: React.Dispatch<React.SetStateAction<string>>;
  setRepFromContacts: React.Dispatch<React.SetStateAction<boolean>>;
  repPickerRef: React.RefObject<HTMLDivElement | null>;
  showRepPicker: boolean;
  setShowRepPicker: React.Dispatch<React.SetStateAction<boolean>>;
  repPickerSearch: string;
  setRepPickerSearch: React.Dispatch<React.SetStateAction<string>>;
  allContacts: ContactEmail[];
  setPhone: React.Dispatch<React.SetStateAction<string>>;
  phone: string;
  priority: string;
  setPriority: React.Dispatch<React.SetStateAction<string>>;
  notes: string;
  setNotes: React.Dispatch<React.SetStateAction<string>>;
}) {
  const {
    subject, setSubject,
    location, setLocation,
    representative, setRepresentative,
    setRepFromContacts,
    repPickerRef,
    showRepPicker, setShowRepPicker,
    repPickerSearch, setRepPickerSearch,
    allContacts,
    setPhone,
    phone,
    priority, setPriority,
    notes, setNotes,
  } = props;

  return (
    <>
      {/* Subject */}
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">موضوع جلسه</label>
        <input required type="text" value={subject} onChange={e => setSubject(e.target.value)}
          className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">محل برگزاری</label>
          <input required type="text" value={location} onChange={e => setLocation(e.target.value)}
            className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white" />
        </div>
        <div className="relative" ref={repPickerRef}>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">نماینده</label>
          <div className="relative">
            <input required type="text" value={representative}
              onChange={e => { setRepresentative(e.target.value); setRepFromContacts(false); }}
              className="w-full p-2 pl-9 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white" />
            <button type="button" onClick={() => { setShowRepPicker(v => !v); setRepPickerSearch(''); }}
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
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">شماره تماس</label>
          <input required type="tel" value={phone} onChange={e => { setPhone(e.target.value); setRepFromContacts(false); }}
            className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">اولویت</label>
          <select value={priority} onChange={e => setPriority(e.target.value)}
            className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white">
            <option value="high">بالا</option>
            <option value="medium">متوسط</option>
            <option value="low">پایین</option>
          </select>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">یادداشت‌ها</label>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
          className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white resize-none" />
      </div>
    </>
  );
}
