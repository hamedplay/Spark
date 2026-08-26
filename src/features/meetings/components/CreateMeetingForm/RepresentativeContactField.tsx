import { useState, useEffect, useRef } from 'react';
import { BookUser } from 'lucide-react';
import type { ContactEmail } from '../../../../types';

export interface RepresentativeContactFieldProps {
  representative: string;
  phone: string;
  contacts: ContactEmail[];

  onRepresentativeChange: (value: string) => void;
  onPhoneChange: (value: string) => void;
  onSelectContact: (contact: ContactEmail) => void;
}

export function RepresentativeContactField({
  representative,
  phone,
  contacts,
  onRepresentativeChange,
  onPhoneChange,
  onSelectContact,
}: RepresentativeContactFieldProps) {
  const [showRepPicker, setShowRepPicker] = useState(false);
  const [repPickerSearch, setRepPickerSearch] = useState('');
  const repPickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showRepPicker) return;
    const handler = (e: MouseEvent) => {
      if (repPickerRef.current && !repPickerRef.current.contains(e.target as Node)) {
        setShowRepPicker(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showRepPicker]);

  const filteredRepContacts = contacts.filter(c =>
    c.name.toLowerCase().includes(repPickerSearch.toLowerCase()) ||
    (c.phone || '').includes(repPickerSearch)
  );

  return (
    <>
      <div className="relative" ref={repPickerRef}>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">نماینده</label>
        <div className="flex gap-2">
          <input required type="text" value={representative}
            onChange={(e) => onRepresentativeChange(e.target.value)}
            className="flex-1 p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white" />
          <button type="button" onClick={() => { setShowRepPicker(v => !v); setRepPickerSearch(''); }}
            className="px-2.5 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 hover:bg-blue-50 dark:hover:bg-blue-900/20 text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
            title="انتخاب از مخاطبین">
            <BookUser className="w-4 h-4" />
          </button>
        </div>
        {showRepPicker && (
          <div className="absolute z-30 left-0 right-0 top-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-xl shadow-xl">
            <div className="p-2 border-b border-gray-100 dark:border-gray-700">
              <input autoFocus type="text" value={repPickerSearch} onChange={e => setRepPickerSearch(e.target.value)}
                placeholder="جستجو در مخاطبین..." className="w-full px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="max-h-48 overflow-y-auto">
              {filteredRepContacts.length === 0 ? (
                <div className="p-3 text-sm text-gray-400 text-center">مخاطبی یافت نشد</div>
              ) : filteredRepContacts.map(c => (
                <button key={c.id} type="button"
                  onClick={() => {
                    onSelectContact(c);
                    setShowRepPicker(false);
                  }}
                  className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700 text-sm transition-colors">
                  <span className="font-medium dark:text-white">{c.name}</span>
                  {c.phone && <span className="text-xs text-gray-400 ltr">{c.phone}</span>}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">شماره تماس</label>
        <input required type="tel" value={phone} onChange={(e) => onPhoneChange(e.target.value)}
          className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white" />
      </div>
    </>
  );
}
