interface ContactFormFieldsProps {
  name: string;
  phone: string;
  company: string;
  position: string;
  onNameChange: (value: string) => void;
  onPhoneChange: (value: string) => void;
  onCompanyChange: (value: string) => void;
  onPositionChange: (value: string) => void;
}

export function ContactFormFields({
  name,
  phone,
  company,
  position,
  onNameChange,
  onPhoneChange,
  onCompanyChange,
  onPositionChange,
}: ContactFormFieldsProps) {
  const inputClass = 'w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 placeholder-slate-400 outline-none transition focus:border-violet-300 focus:ring-2 focus:ring-violet-500/10 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:placeholder-slate-500';

  return (
    <div className="grid min-w-0 grid-cols-1 gap-2.5 md:grid-cols-2">
      <input
        required
        type="text"
        value={name}
        onChange={(e) => onNameChange(e.target.value)}
        placeholder="نام و نام خانوادگی *"
        className={inputClass}
      />
      <input
        type="tel"
        inputMode="tel"
        dir="ltr"
        value={phone}
        onChange={(e) => onPhoneChange(e.target.value)}
        placeholder="09123456789"
        className={`${inputClass} text-left focus:border-cyan-300 focus:ring-cyan-500/10`}
      />
      <input
        type="text"
        value={company}
        onChange={(e) => onCompanyChange(e.target.value)}
        placeholder="سازمان / شرکت (اختیاری)"
        className={`${inputClass} focus:border-blue-300 focus:ring-blue-500/10`}
      />
      <input
        type="text"
        value={position}
        onChange={(e) => onPositionChange(e.target.value)}
        placeholder="سمت سازمانی (اختیاری)"
        className={`${inputClass} focus:border-amber-300 focus:ring-amber-500/10`}
      />
    </div>
  );
}
