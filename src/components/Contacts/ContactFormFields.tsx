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
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      <input
        required
        type="text"
        value={name}
        onChange={(e) => onNameChange(e.target.value)}
        placeholder="نام و نام خانوادگی *"
        className="px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white text-sm"
      />
      <input
        type="tel"
        value={phone}
        onChange={(e) => onPhoneChange(e.target.value)}
        placeholder="شماره موبایل"
        className="px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white text-sm"
      />
      <input
        type="text"
        value={company}
        onChange={(e) => onCompanyChange(e.target.value)}
        placeholder="سازمان / شرکت (اختیاری)"
        className="px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white text-sm"
      />
      <input
        type="text"
        value={position}
        onChange={(e) => onPositionChange(e.target.value)}
        placeholder="سمت سازمانی (اختیاری)"
        className="px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white text-sm"
      />
    </div>
  );
}
