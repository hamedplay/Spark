import { INP } from './utils';

export function JalaliInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input
      type="text"
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder || 'مثال: 1403/06/15'}
      className={INP}
      dir="ltr"
    />
  );
}
