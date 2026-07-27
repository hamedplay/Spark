export const INVITATION_OPTIONS = [
  { value: 'invited',   label: 'دعوت‌شده' },
  { value: 'accepted',  label: 'پذیرفته' },
  { value: 'declined',  label: 'ردشده' },
  { value: 'pending',  label: 'در انتظار پاسخ' },
  { value: 'no_response', label: 'بدون پاسخ' },
  { value: 'delegated', label: 'تفویض‌شده' },
];

export const ATTENDANCE_OPTIONS_WITH_NULL = [
  { value: '',                label: '—' },
  { value: 'present',         label: 'حاضر' },
  { value: 'absent',          label: 'غایب' },
  { value: 'online',          label: 'آنلاین' },
  { value: 'late',            label: 'با تأخیر' },
  { value: 'delegate_attended', label: 'حضور جانشین' },
];

export const AGENDA_RESULT_OPTIONS = [
  { value: 'discussion', label: 'بحث و بررسی' },
  { value: 'action',     label: 'اقدام اجرایی' },
  { value: 'resolution', label: 'مصوبه' },
  { value: 'deferred',   label: 'موکول‌شده' },
  { value: 'no_result',  label: 'بدون نتیجه' },
];

export const PRIORITY_OPTIONS = [
  { value: 'low',       label: 'کم' },
  { value: 'normal',    label: 'عادی' },
  { value: 'important', label: 'مهم' },
  { value: 'urgent',    label: 'فوری' },
];
