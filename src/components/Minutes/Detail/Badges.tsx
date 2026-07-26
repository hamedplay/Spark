const INV_LABELS: Record<string, { label: string; cls: string }> = {
  invited:    { label: 'دعوت‌شده',    cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
  accepted:   { label: 'پذیرفته',    cls: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
  declined:   { label: 'ردشده',      cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
  no_response:{ label: 'بدون پاسخ',  cls: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400' },
  delegated:  { label: 'تفویض‌شده',  cls: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400' },
};

export function InvitationBadge({ status }: { status: string }) {
  const cfg = INV_LABELS[status] || { label: status, cls: 'bg-gray-100 text-gray-600' };
  return <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${cfg.cls}`}>{cfg.label}</span>;
}

const ATT_LABELS: Record<string, { label: string; cls: string }> = {
  present:           { label: 'حاضر',         cls: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
  absent:            { label: 'غایب',          cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
  online:            { label: 'آنلاین',        cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
  late:              { label: 'با تأخیر',      cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
  delegate_attended: { label: 'حضور جانشین',  cls: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400' },
};

export function AttendanceBadge({ status }: { status: string }) {
  const cfg = ATT_LABELS[status] || { label: status, cls: 'bg-gray-100 text-gray-600' };
  return <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${cfg.cls}`}>{cfg.label}</span>;
}

const AGENDA_RESULT_LABELS: Record<string, { label: string; cls: string }> = {
  discussion: { label: 'بحث و بررسی',   cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
  action:     { label: 'اقدام اجرایی',   cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
  resolution: { label: 'مصوبه',         cls: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
  deferred:   { label: 'موکول‌شده',     cls: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' },
  no_result:  { label: 'بدون نتیجه',    cls: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400' },
};

export function AgendaResultBadge({ type }: { type: string }) {
  const cfg = AGENDA_RESULT_LABELS[type] || { label: type, cls: 'bg-gray-100 text-gray-600' };
  return <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium flex-shrink-0 ${cfg.cls}`}>{cfg.label}</span>;
}
