import { useState, useEffect } from 'react';
import { Save, Eye, EyeOff } from 'lucide-react';
import type { ConfigEntry } from './types';
import { SELECT_OPTIONS } from './types';

export function ConfigField({ entry, onSave }: { entry: ConfigEntry; onSave: (id: string, value: string) => void }) {
  const [val, setVal] = useState(entry.value ?? '');
  const [showPass, setShowPass] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => { setVal(entry.value ?? ''); setDirty(false); }, [entry.value]);
  const change = (v: string) => { setVal(v); setDirty(v !== (entry.value ?? '')); };

  const inputCls = 'w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors';

  const selectOptions = entry.value_type === 'select' ? (SELECT_OPTIONS[entry.key] ?? []) : [];

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">{entry.label || entry.key}</label>
        {dirty && (
          <button onClick={() => { onSave(entry.id, val); setDirty(false); }}
            className="flex items-center gap-1 px-2.5 py-1 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-xs font-medium transition-colors">
            <Save className="w-3 h-3" /> ذخیره
          </button>
        )}
      </div>
      {entry.description && entry.value_type !== 'select' && (
        <p className="text-xs text-gray-400 dark:text-gray-500">{entry.description}</p>
      )}
      {entry.value_type === 'boolean' ? (
        <button onClick={() => { const n = val === 'true' ? 'false' : 'true'; change(n); onSave(entry.id, n); }}
          className={`relative w-12 h-6 rounded-full transition-colors flex-shrink-0 ${val === 'true' ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'}`}>
          <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${val === 'true' ? 'translate-x-6' : 'translate-x-0.5'}`} />
        </button>
      ) : entry.value_type === 'password' ? (
        <div className="relative">
          <input type={showPass ? 'text' : 'password'} value={val} onChange={e => change(e.target.value)} className={inputCls} />
          <button onClick={() => setShowPass(v => !v)} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
            {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
      ) : entry.value_type === 'color' ? (
        <div className="flex items-center gap-2">
          <input type="color" value={val || '#3b82f6'} onChange={e => change(e.target.value)}
            className="w-10 h-10 rounded-xl border border-gray-200 dark:border-gray-600 cursor-pointer p-0.5 bg-white dark:bg-gray-700" />
          <input type="text" value={val} onChange={e => change(e.target.value)} className={`${inputCls} flex-1`} placeholder="#000000" />
        </div>
      ) : entry.value_type === 'number' ? (
        <input type="number" value={val} onChange={e => change(e.target.value)} className={inputCls} />
      ) : entry.value_type === 'time' ? (
        <input type="time" value={val} onChange={e => change(e.target.value)} className={inputCls} />
      ) : entry.value_type === 'select' && selectOptions.length > 0 ? (
        <div className="flex flex-col gap-2" dir="rtl">
          {selectOptions.map(opt => (
            <button
              key={opt.value}
              onClick={() => { change(opt.value); onSave(entry.id, opt.value); }}
              className={`w-full text-right px-3.5 py-2.5 rounded-xl border-2 transition-all ${
                val === opt.value
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                  : 'border-gray-200 dark:border-gray-600 hover:border-blue-300 dark:hover:border-blue-700 bg-white dark:bg-gray-700'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className={`w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center transition-colors ${
                  val === opt.value ? 'border-blue-500' : 'border-gray-300 dark:border-gray-500'
                }`}>
                  {val === opt.value && <span className="w-2 h-2 rounded-full bg-blue-500" />}
                </span>
                <span className={`text-sm font-semibold ${val === opt.value ? 'text-blue-700 dark:text-blue-300' : 'text-gray-700 dark:text-gray-200'}`}>
                  {opt.label}
                </span>
              </div>
              <p className={`text-xs mt-1 mr-6 text-right leading-relaxed ${val === opt.value ? 'text-blue-500 dark:text-blue-400' : 'text-gray-400 dark:text-gray-500'}`}>
                {opt.description}
              </p>
            </button>
          ))}
        </div>
      ) : (
        <input type="text" value={val} onChange={e => change(e.target.value)} className={inputCls} />
      )}
    </div>
  );
}

export function SectionCard({ title, icon: Icon, color = 'blue', children }: { title: string; icon: React.ElementType; color?: string; children: React.ReactNode }) {
  const colors: Record<string, string> = {
    blue: 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400',
    green: 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400',
    amber: 'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400',
    red: 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400',
    teal: 'bg-teal-50 dark:bg-teal-900/20 text-teal-600 dark:text-teal-400',
    gray: 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400',
  };
  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-3.5 border-b border-gray-100 dark:border-gray-700">
        <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${colors[color] || colors.blue}`}>
          <Icon className="w-4 h-4" />
        </div>
        <h3 className="font-bold text-gray-800 dark:text-white">{title}</h3>
      </div>
      <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-5">{children}</div>
    </div>
  );
}
