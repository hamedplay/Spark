import { CircleAlert as AlertCircle, Loader as Loader2 } from 'lucide-react';

export function LoadingSelect({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 min-w-0 px-3 py-2.5 text-sm text-gray-400 border border-gray-200 dark:border-gray-600 rounded-xl dark:bg-gray-700">
      <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />
      <span className="min-w-0 break-words">{label}</span>
    </div>
  );
}

export function LoadingRow({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-8 text-sm text-gray-400">
      <Loader2 className="w-5 h-5 animate-spin flex-shrink-0" />
      <span className="min-w-0 break-words">{label}</span>
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 min-w-0 p-3 bg-red-50 dark:bg-red-900/20 rounded-xl text-sm text-red-600 dark:text-red-400">
      <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
      <span className="min-w-0 break-words">{message}</span>
    </div>
  );
}

export function ComingSoonBanner({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 min-w-0 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900/40 rounded-xl p-3 text-sm text-amber-700 dark:text-amber-400">
      <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
      <span className="min-w-0 break-words">{message}</span>
    </div>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center py-4 text-sm text-gray-400 text-center break-words">
      {message}
    </div>
  );
}

export interface InputFieldProps {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
}

export function InputField({ id, label, placeholder, value, onChange }: InputFieldProps) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{label}</label>
      <input
        id={id}
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full min-w-0 px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:bg-gray-700 dark:text-white placeholder-gray-400"
      />
    </div>
  );
}

export interface TextareaFieldProps {
  id: string;
  label: string;
  rows: number;
  value: string;
  onChange: (value: string) => void;
}

export function TextareaField({ id, label, rows, value, onChange }: TextareaFieldProps) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{label}</label>
      <textarea
        id={id}
        rows={rows}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full min-w-0 px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:bg-gray-700 dark:text-white placeholder-gray-400 resize-none"
      />
    </div>
  );
}

export interface SelectFieldProps {
  id: string;
  label: string;
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

export function SelectField({ id, label, options, value, onChange, disabled = false }: SelectFieldProps) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{label}</label>
      <select
        id={id}
        value={value}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
        className="w-full min-w-0 px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:bg-gray-700 dark:text-white disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}
