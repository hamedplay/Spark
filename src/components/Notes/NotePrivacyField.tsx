export function NotePrivacyField({ value, onChange }: { value: boolean; onChange: (value: boolean) => void }) {
  return <label className="flex items-start gap-2 rounded-lg border border-slate-200 p-2 text-xs leading-6 text-slate-600 dark:border-slate-700 dark:text-slate-300">
    <input type="checkbox" className="mt-1.5" checked={!value} onChange={event => onChange(!event.target.checked)} />
    <span>متن و عنوان یادداشت در پیامک و بله ارسال نشود؛ دریافت‌کننده متن کامل را در اعلان داخل سامانه می‌بیند.</span>
  </label>;
}
