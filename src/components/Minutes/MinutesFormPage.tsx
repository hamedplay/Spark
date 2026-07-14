import { useState } from 'react';
import { ChevronRight, ChevronLeft, Plus, Trash2, GripVertical, Users, FileText, SquareCheck as CheckSquare, Paperclip, Shield, Signature as FileSignature, Save, Eye, Send, X, CircleAlert as AlertCircle, Upload } from 'lucide-react';
import { PageHeader, ConfidentialityBadge } from './MinutesShared';
import type {
  ConfidentialityLevel, InvitationStatus, AttendanceStatus,
  AgendaResultType, DecisionPriority, DecisionStatus, ApprovalMethod,
} from './types';

interface Props {
  mode: 'new' | 'edit';
  onNavigate: (page: string) => void;
}

const SECTIONS = [
  { id: 'info',         label: 'اطلاعات جلسه',           icon: FileText },
  { id: 'participants', label: 'شرکت‌کنندگان',             icon: Users },
  { id: 'agenda',       label: 'دستور جلسات',              icon: CheckSquare },
  { id: 'decisions',    label: 'مصوبات',                   icon: CheckSquare },
  { id: 'attachments',  label: 'پیوست‌ها',                 icon: Paperclip },
  { id: 'approvers',    label: 'تأییدکنندگان',             icon: Shield },
  { id: 'final',        label: 'نسخه نهایی',               icon: FileSignature },
];

export function MinutesFormPage({ mode, onNavigate }: Props) {
  const [activeSection, setActiveSection] = useState(0);
  const [isDirty, setIsDirty] = useState(false);
  void isDirty;

  const title = mode === 'new' ? 'ایجاد صورت‌جلسه' : 'ویرایش صورت‌جلسه';

  const markDirty = () => setIsDirty(true);

  return (
    <div dir="rtl" className="space-y-5">
      <PageHeader
        title={title}
        actions={
          <button
            onClick={() => onNavigate('minutes')}
            className="flex items-center gap-2 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-sm transition-colors"
          >
            <X className="w-4 h-4" />
            انصراف
          </button>
        }
      />

      <div className="flex gap-5">
        {/* Section Stepper — desktop sidebar */}
        <div className="hidden lg:flex flex-col gap-1 w-48 flex-shrink-0">
          {SECTIONS.map((s, i) => {
            const Icon = s.icon;
            const isActive = i === activeSection;
            const isDone = i < activeSection;
            return (
              <button
                key={s.id}
                onClick={() => setActiveSection(i)}
                className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-all text-right ${
                  isActive
                    ? 'bg-blue-600 text-white shadow-sm'
                    : isDone
                    ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
              >
                <Icon className="w-4 h-4 flex-shrink-0" />
                <span className="truncate">{s.label}</span>
              </button>
            );
          })}
        </div>

        {/* Main form area */}
        <div className="flex-1 min-w-0">
          {/* Mobile section tabs */}
          <div className="lg:hidden flex gap-1 overflow-x-auto pb-2 mb-4">
            {SECTIONS.map((s, i) => (
              <button
                key={s.id}
                onClick={() => setActiveSection(i)}
                className={`flex-shrink-0 px-3 py-2 rounded-xl text-xs font-medium transition-colors ${
                  i === activeSection
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-6">
            {activeSection === 0 && <SectionInfo onChange={markDirty} />}
            {activeSection === 1 && <SectionParticipants onChange={markDirty} />}
            {activeSection === 2 && <SectionAgenda onChange={markDirty} />}
            {activeSection === 3 && <SectionDecisions onChange={markDirty} />}
            {activeSection === 4 && <SectionAttachments onChange={markDirty} />}
            {activeSection === 5 && <SectionApprovers onChange={markDirty} />}
            {activeSection === 6 && <SectionFinal onChange={markDirty} />}
          </div>

          {/* Navigation buttons */}
          <div className="flex items-center justify-between mt-4 flex-wrap gap-3">
            <button
              onClick={() => setActiveSection(s => Math.max(0, s - 1))}
              disabled={activeSection === 0}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronRight className="w-4 h-4" />
              بخش قبلی
            </button>

            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => {}}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
              >
                <Save className="w-4 h-4" />
                ذخیره پیش‌نویس
              </button>
              <button
                onClick={() => onNavigate('minutes-detail')}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
              >
                <Eye className="w-4 h-4" />
                پیش‌نمایش
              </button>
              {activeSection === SECTIONS.length - 1 ? (
                <button
                  onClick={() => {}}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-amber-500 hover:bg-amber-600 text-white transition-colors"
                >
                  <Send className="w-4 h-4" />
                  ارسال برای تأیید
                </button>
              ) : (
                <button
                  onClick={() => setActiveSection(s => Math.min(SECTIONS.length - 1, s + 1))}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white transition-colors"
                >
                  ذخیره و ادامه
                  <ChevronLeft className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 1 — Meeting Info
// ─────────────────────────────────────────────────────────────────────────────

function SectionInfo({ onChange }: { onChange: () => void }) {
  const [confidentiality, setConfidentiality] = useState<ConfidentialityLevel>('organizational');

  return (
    <div className="space-y-5" onChange={onChange}>
      <h2 className="text-lg font-bold text-gray-900 dark:text-white border-b border-gray-100 dark:border-gray-700 pb-3">
        اطلاعات جلسه
      </h2>

      {/* Meeting selector hint */}
      <div className="flex items-start gap-3 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-xl text-sm text-blue-700 dark:text-blue-300">
        <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
        صورت‌جلسه فقط برای جلساتی قابل ایجاد است که در تقویم کاربر قرار دارند.
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="sm:col-span-2">
          <label htmlFor="meeting-select" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            انتخاب جلسه
          </label>
          <select
            id="meeting-select"
            className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:bg-gray-700 dark:text-white"
          >
            <option value="">انتخاب کنید...</option>
            <option value="j1">جلسه بررسی برنامه‌ریزی سالانه — ۱۴۰۳/۰۵/۱۲</option>
            <option value="j2">جلسه هماهنگی پروژه — ۱۴۰۳/۰۵/۰۸</option>
          </select>
        </div>

        <div className="sm:col-span-2">
          <label htmlFor="meeting-title" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            عنوان جلسه <span className="text-red-500">*</span>
          </label>
          <input
            id="meeting-title"
            type="text"
            className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:bg-gray-700 dark:text-white"
            placeholder="عنوان جلسه را وارد کنید"
          />
        </div>

        <div>
          <label htmlFor="meeting-date" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            تاریخ جلسه <span className="text-red-500">*</span>
          </label>
          <input
            id="meeting-date"
            type="text"
            className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:bg-gray-700 dark:text-white"
            placeholder="۱۴۰۳/۰۵/۱۲"
          />
        </div>

        <div>
          <label htmlFor="meeting-type" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            نوع جلسه
          </label>
          <select
            id="meeting-type"
            className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:bg-gray-700 dark:text-white"
          >
            <option value="">انتخاب کنید</option>
            <option value="board">هیئت مدیره</option>
            <option value="management">مدیریتی</option>
            <option value="operational">عملیاتی</option>
            <option value="project">پروژه</option>
            <option value="coordination">هماهنگی</option>
          </select>
        </div>

        <div>
          <label htmlFor="start-time" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            ساعت شروع
          </label>
          <input
            id="start-time"
            type="time"
            className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:bg-gray-700 dark:text-white"
          />
        </div>

        <div>
          <label htmlFor="end-time" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            ساعت پایان
          </label>
          <input
            id="end-time"
            type="time"
            className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:bg-gray-700 dark:text-white"
          />
        </div>

        <div>
          <label htmlFor="location" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            محل برگزاری
          </label>
          <input
            id="location"
            type="text"
            className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:bg-gray-700 dark:text-white"
            placeholder="اتاق جلسات / آنلاین"
          />
        </div>

        <div>
          <label htmlFor="org-unit" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            واحد برگزارکننده
          </label>
          <input
            id="org-unit"
            type="text"
            className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:bg-gray-700 dark:text-white"
          />
        </div>

        <div>
          <label htmlFor="secretary" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            دبیر جلسه <span className="text-red-500">*</span>
          </label>
          <input
            id="secretary"
            type="text"
            className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:bg-gray-700 dark:text-white"
          />
        </div>

        <div>
          <label htmlFor="chair" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            رئیس جلسه <span className="text-red-500">*</span>
          </label>
          <input
            id="chair"
            type="text"
            className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:bg-gray-700 dark:text-white"
          />
        </div>

        <div className="sm:col-span-2">
          <label htmlFor="notes" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            توضیحات
          </label>
          <textarea
            id="notes"
            rows={3}
            className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:bg-gray-700 dark:text-white resize-none"
          />
        </div>

        <div>
          <label htmlFor="confidentiality" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            سطح محرمانگی
          </label>
          <div className="flex items-center gap-3">
            <select
              id="confidentiality"
              value={confidentiality}
              onChange={e => setConfidentiality(e.target.value as ConfidentialityLevel)}
              className="flex-1 px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:bg-gray-700 dark:text-white"
            >
              <option value="public">عمومی</option>
              <option value="organizational">سازمانی</option>
              <option value="restricted">محدود</option>
              <option value="confidential">محرمانه</option>
            </select>
            <ConfidentialityBadge level={confidentiality} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 2 — Participants
// ─────────────────────────────────────────────────────────────────────────────

function SectionParticipants({ onChange }: { onChange: () => void }) {
  const [internalList, setInternalList] = useState([
    { id: '1', name: '', position: '', orgUnit: '', invitationStatus: 'invited' as InvitationStatus, attendanceStatus: 'present' as AttendanceStatus, delegate: '', notes: '' },
  ]);
  const [externalList, setExternalList] = useState([
    { id: '1', fullName: '', organization: '', position: '', mobile: '', email: '', attendanceStatus: 'present' as AttendanceStatus },
  ]);

  const addInternal = () => {
    onChange();
    setInternalList(l => [...l, { id: String(Date.now()), name: '', position: '', orgUnit: '', invitationStatus: 'invited', attendanceStatus: 'present', delegate: '', notes: '' }]);
  };

  const removeInternal = (id: string) => setInternalList(l => l.filter(r => r.id !== id));

  const addExternal = () => {
    onChange();
    setExternalList(l => [...l, { id: String(Date.now()), fullName: '', organization: '', position: '', mobile: '', email: '', attendanceStatus: 'present' }]);
  };

  const removeExternal = (id: string) => setExternalList(l => l.filter(r => r.id !== id));

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-bold text-gray-900 dark:text-white border-b border-gray-100 dark:border-gray-700 pb-3">
        شرکت‌کنندگان
      </h2>

      {/* Internal participants */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">شرکت‌کنندگان داخلی</h3>
          <button
            onClick={addInternal}
            className="flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400 hover:underline"
          >
            <Plus className="w-3.5 h-3.5" /> افزودن
          </button>
        </div>
        <div className="space-y-3">
          {internalList.map(row => (
            <div key={row.id} className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-6 gap-2 p-3 bg-gray-50 dark:bg-gray-700/30 rounded-xl">
              <InputField id={`int-name-${row.id}`} label="نام" placeholder="نام شرکت‌کننده" />
              <InputField id={`int-pos-${row.id}`} label="سمت" placeholder="سمت" />
              <InputField id={`int-unit-${row.id}`} label="واحد" placeholder="واحد" />
              <SelectField id={`int-inv-${row.id}`} label="وضعیت دعوت" options={INVITATION_OPTIONS} />
              <SelectField id={`int-att-${row.id}`} label="وضعیت حضور" options={ATTENDANCE_OPTIONS} />
              <div className="flex items-end">
                <button
                  onClick={() => removeInternal(row.id)}
                  aria-label="حذف ردیف"
                  className="p-2 rounded-xl text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* External participants */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">شرکت‌کنندگان خارجی</h3>
          <button
            onClick={addExternal}
            className="flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400 hover:underline"
          >
            <Plus className="w-3.5 h-3.5" /> افزودن
          </button>
        </div>
        <div className="space-y-3">
          {externalList.map(row => (
            <div key={row.id} className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-6 gap-2 p-3 bg-gray-50 dark:bg-gray-700/30 rounded-xl">
              <InputField id={`ext-name-${row.id}`} label="نام و نام خانوادگی" placeholder="" />
              <InputField id={`ext-org-${row.id}`} label="سازمان" placeholder="" />
              <InputField id={`ext-pos-${row.id}`} label="سمت" placeholder="" />
              <InputField id={`ext-mob-${row.id}`} label="موبایل" placeholder="" />
              <SelectField id={`ext-att-${row.id}`} label="وضعیت حضور" options={ATTENDANCE_OPTIONS} />
              <div className="flex items-end">
                <button
                  onClick={() => removeExternal(row.id)}
                  aria-label="حذف ردیف"
                  className="p-2 rounded-xl text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 3 — Agenda
// ─────────────────────────────────────────────────────────────────────────────

function SectionAgenda({ onChange }: { onChange: () => void }) {
  const [items, setItems] = useState([
    { id: '1', order: 1, title: '', resultType: 'discussion' as AgendaResultType },
  ]);

  const add = () => {
    onChange();
    setItems(l => [...l, { id: String(Date.now()), order: l.length + 1, title: '', resultType: 'discussion' }]);
  };

  const remove = (id: string) => setItems(l => l.filter(r => r.id !== id));

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between border-b border-gray-100 dark:border-gray-700 pb-3">
        <h2 className="text-lg font-bold text-gray-900 dark:text-white">دستور جلسات و نتایج</h2>
        <button onClick={add} className="flex items-center gap-1.5 text-sm text-blue-600 dark:text-blue-400 hover:underline">
          <Plus className="w-4 h-4" /> افزودن دستور
        </button>
      </div>

      {items.map((item, idx) => (
        <div key={item.id} className="border border-gray-200 dark:border-gray-600 rounded-2xl overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-2 bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-600">
            <GripVertical className="w-4 h-4 text-gray-400 cursor-grab" />
            <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">دستور {idx + 1}</span>
            <div className="flex-1" />
            <button onClick={() => remove(item.id)} aria-label="حذف دستور" className="p-1 rounded-lg text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
          <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <InputField id={`ag-title-${item.id}`} label="عنوان دستور جلسه" placeholder="عنوان دستور را وارد کنید" />
            </div>
            <TextareaField id={`ag-desc-${item.id}`} label="شرح" rows={2} />
            <div className="space-y-3">
              <InputField id={`ag-presenter-${item.id}`} label="ارائه‌دهنده" placeholder="" />
              <InputField id={`ag-time-${item.id}`} label="زمان اختصاص‌یافته (دقیقه)" placeholder="30" />
            </div>
            <TextareaField id={`ag-result-${item.id}`} label="نتیجه بحث" rows={2} />
            <div className="space-y-3">
              <SelectField id={`ag-type-${item.id}`} label="نوع نتیجه" options={AGENDA_RESULT_OPTIONS} />
              <InputField id={`ag-notes-${item.id}`} label="توضیحات تکمیلی" placeholder="" />
            </div>
            <div className="sm:col-span-2 flex items-center gap-2 flex-wrap">
              <button className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 hover:bg-blue-100 transition-colors">
                <Plus className="w-3.5 h-3.5" /> افزودن نتیجه
              </button>
              <button className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 hover:bg-green-100 transition-colors">
                <Plus className="w-3.5 h-3.5" /> افزودن مصوبه
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 4 — Decisions
// ─────────────────────────────────────────────────────────────────────────────

function SectionDecisions({ onChange }: { onChange: () => void }) {
  const [items, setItems] = useState([
    { id: '1', title: '', priority: 'normal' as DecisionPriority, status: 'not_started' as DecisionStatus },
  ]);

  const add = () => {
    onChange();
    setItems(l => [...l, { id: String(Date.now()), title: '', priority: 'normal', status: 'not_started' }]);
  };

  const remove = (id: string) => setItems(l => l.filter(r => r.id !== id));

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between border-b border-gray-100 dark:border-gray-700 pb-3">
        <h2 className="text-lg font-bold text-gray-900 dark:text-white">مصوبات</h2>
        <button onClick={add} className="flex items-center gap-1.5 text-sm text-blue-600 dark:text-blue-400 hover:underline">
          <Plus className="w-4 h-4" /> افزودن مصوبه
        </button>
      </div>

      {items.map((item, idx) => (
        <div key={item.id} className="border border-gray-200 dark:border-gray-600 rounded-2xl overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-2 bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-600">
            <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">مصوبه {idx + 1}</span>
            <div className="flex-1" />
            <button onClick={() => remove(item.id)} aria-label="حذف مصوبه" className="p-1 rounded-lg text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
          <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <InputField id={`dec-title-${item.id}`} label="عنوان مصوبه" placeholder="عنوان مصوبه را وارد کنید" />
            </div>
            <TextareaField id={`dec-desc-${item.id}`} label="شرح کامل" rows={3} />
            <div className="space-y-3">
              <SelectField id={`dec-priority-${item.id}`} label="اولویت" options={PRIORITY_OPTIONS} />
              <SelectField id={`dec-status-${item.id}`} label="وضعیت" options={DECISION_STATUS_OPTIONS} />
            </div>
            <InputField id={`dec-owner-${item.id}`} label="مسئول اصلی" placeholder="" />
            <InputField id={`dec-unit-${item.id}`} label="واحد مسئول" placeholder="" />
            <InputField id={`dec-start-${item.id}`} label="تاریخ شروع" placeholder="۱۴۰۳/۰۵/۱۵" />
            <InputField id={`dec-deadline-${item.id}`} label="مهلت انجام" placeholder="۱۴۰۳/۰۶/۱۰" />
            <div className="sm:col-span-2">
              <label htmlFor={`dec-progress-${item.id}`} className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                درصد پیشرفت
              </label>
              <input
                id={`dec-progress-${item.id}`}
                type="range"
                min={0}
                max={100}
                step={5}
                defaultValue={0}
                className="w-full accent-blue-600"
              />
            </div>
            <div className="sm:col-span-2 flex items-center gap-3">
              <label htmlFor={`dec-followup-${item.id}`} className="flex items-center gap-2 cursor-pointer select-none">
                <input id={`dec-followup-${item.id}`} type="checkbox" className="w-4 h-4 rounded accent-blue-600" />
                <span className="text-sm text-gray-700 dark:text-gray-300">نیازمند پیگیری</span>
              </label>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 5 — Attachments
// ─────────────────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function SectionAttachments(_props: { onChange: () => void }) {
  const [files] = useState<{ name: string; type: string; size: string }[]>([]);

  return (
    <div className="space-y-5">
      <h2 className="text-lg font-bold text-gray-900 dark:text-white border-b border-gray-100 dark:border-gray-700 pb-3">
        پیوست‌ها
      </h2>

      {/* Drop zone */}
      <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-2xl p-8 text-center hover:border-blue-400 dark:hover:border-blue-500 transition-colors">
        <Upload className="w-10 h-10 text-gray-400 mx-auto mb-3" />
        <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">فایل را اینجا رها کنید</p>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">یا</p>
        <button className="flex items-center gap-2 mx-auto px-4 py-2 rounded-xl bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 text-sm font-medium hover:bg-blue-100 transition-colors">
          <Paperclip className="w-4 h-4" />
          انتخاب فایل
        </button>
        <p className="text-xs text-gray-400 mt-3">آپلود واقعی در این مرحله فعال نیست</p>
      </div>

      {files.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-4">هیچ فایلی پیوست نشده است.</p>
      ) : (
        <div className="space-y-2">
          {files.map((f, i) => (
            <div key={i} className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700/30 rounded-xl">
              <Paperclip className="w-4 h-4 text-gray-400" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{f.name}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">{f.type} · {f.size}</p>
              </div>
              <button aria-label="حذف پیوست" className="p-1.5 rounded-lg text-red-400 hover:bg-red-50 transition-colors">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 6 — Approvers
// ─────────────────────────────────────────────────────────────────────────────

function SectionApprovers({ onChange }: { onChange: () => void }) {
  const [approvers, setApprovers] = useState([
    { id: '1', name: '', position: '', unit: '', order: 1, method: 'digital' as ApprovalMethod },
  ]);

  const add = () => {
    onChange();
    setApprovers(l => [...l, { id: String(Date.now()), name: '', position: '', unit: '', order: l.length + 1, method: 'digital' }]);
  };

  const remove = (id: string) => setApprovers(l => l.filter(a => a.id !== id));

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between border-b border-gray-100 dark:border-gray-700 pb-3">
        <h2 className="text-lg font-bold text-gray-900 dark:text-white">تأییدکنندگان</h2>
        <button onClick={add} className="flex items-center gap-1.5 text-sm text-blue-600 dark:text-blue-400 hover:underline">
          <Plus className="w-4 h-4" /> افزودن
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-2">
        <label className="flex items-center gap-3 p-3 border border-gray-200 dark:border-gray-600 rounded-xl cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
          <input type="radio" name="approval-method" defaultChecked className="accent-blue-600" />
          <div>
            <p className="text-sm font-medium text-gray-800 dark:text-gray-200">تأیید سیستمی</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">ارسال درخواست دیجیتال</p>
          </div>
        </label>
        <label className="flex items-center gap-3 p-3 border border-gray-200 dark:border-gray-600 rounded-xl cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
          <input type="radio" name="approval-method" className="accent-blue-600" />
          <div>
            <p className="text-sm font-medium text-gray-800 dark:text-gray-200">تأیید حضوری</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">ثبت تأیید دستی</p>
          </div>
        </label>
      </div>

      <div className="space-y-3">
        {approvers.map((a, idx) => (
          <div key={a.id} className="grid grid-cols-1 sm:grid-cols-4 gap-2 p-3 bg-gray-50 dark:bg-gray-700/30 rounded-xl items-end">
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 text-xs font-semibold flex items-center justify-center flex-shrink-0">
                {idx + 1}
              </span>
              <InputField id={`ap-name-${a.id}`} label="نام" placeholder="" />
            </div>
            <InputField id={`ap-pos-${a.id}`} label="سمت" placeholder="" />
            <InputField id={`ap-unit-${a.id}`} label="واحد" placeholder="" />
            <div className="flex items-end gap-2">
              <SelectField id={`ap-method-${a.id}`} label="نوع تأیید" options={[{ value: 'digital', label: 'سیستمی' }, { value: 'in_person', label: 'حضوری' }]} />
              <button onClick={() => remove(a.id)} aria-label="حذف تأییدکننده" className="p-2 rounded-xl text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors flex-shrink-0">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 7 — Final version & signature
// ─────────────────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function SectionFinal(_props: { onChange: () => void }) {
  return (
    <div className="space-y-5">
      <h2 className="text-lg font-bold text-gray-900 dark:text-white border-b border-gray-100 dark:border-gray-700 pb-3">
        نسخه نهایی و امضا
      </h2>

      {/* Preview area */}
      <div className="border border-gray-200 dark:border-gray-600 rounded-2xl p-6 bg-gray-50 dark:bg-gray-700/20 min-h-48 flex flex-col items-center justify-center gap-2">
        <FileText className="w-12 h-12 text-gray-300 dark:text-gray-600" />
        <p className="text-sm text-gray-500 dark:text-gray-400">پیش‌نمایش صورت‌جلسه</p>
        <button className="mt-2 flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 text-sm font-medium hover:bg-blue-100 transition-colors">
          <Eye className="w-4 h-4" />
          نمایش پیش‌نمایش
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="sm:col-span-2">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">بارگذاری نسخه امضاشده</label>
          <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl p-4 text-center hover:border-blue-400 transition-colors">
            <Upload className="w-6 h-6 text-gray-400 mx-auto mb-1" />
            <p className="text-xs text-gray-500 dark:text-gray-400">بارگذاری واقعی در این مرحله فعال نیست</p>
          </div>
        </div>
        <InputField id="sign-date" label="تاریخ امضا" placeholder="۱۴۰۳/۰۵/۱۸" />
        <InputField id="version-number" label="شماره نسخه" placeholder="۱.۰" />
        <div className="sm:col-span-2">
          <TextareaField id="version-notes" label="توضیحات نسخه" rows={2} />
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Reusable mini form elements
// ─────────────────────────────────────────────────────────────────────────────

function InputField({ id, label, placeholder }: { id: string; label: string; placeholder: string }) {
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{label}</label>
      <input
        id={id}
        type="text"
        placeholder={placeholder}
        className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:bg-gray-700 dark:text-white"
      />
    </div>
  );
}

function TextareaField({ id, label, rows }: { id: string; label: string; rows: number }) {
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{label}</label>
      <textarea
        id={id}
        rows={rows}
        className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:bg-gray-700 dark:text-white resize-none"
      />
    </div>
  );
}

function SelectField({ id, label, options }: { id: string; label: string; options: { value: string; label: string }[] }) {
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{label}</label>
      <select
        id={id}
        className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:bg-gray-700 dark:text-white"
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Option constants
// ─────────────────────────────────────────────────────────────────────────────

const INVITATION_OPTIONS = [
  { value: 'invited',   label: 'دعوت‌شده' },
  { value: 'accepted',  label: 'پذیرفته' },
  { value: 'declined',  label: 'ردشده' },
  { value: 'no_response', label: 'بدون پاسخ' },
  { value: 'delegated', label: 'تفویض‌شده' },
];

const ATTENDANCE_OPTIONS = [
  { value: 'present',           label: 'حاضر' },
  { value: 'absent',            label: 'غایب' },
  { value: 'online',            label: 'آنلاین' },
  { value: 'late',              label: 'با تأخیر' },
  { value: 'delegate_attended', label: 'حضور جانشین' },
];

const AGENDA_RESULT_OPTIONS = [
  { value: 'discussion', label: 'بحث و بررسی' },
  { value: 'action',     label: 'اقدام اجرایی' },
  { value: 'resolution', label: 'مصوبه' },
  { value: 'deferred',   label: 'موکول‌شده' },
  { value: 'no_result',  label: 'بدون نتیجه' },
];

const PRIORITY_OPTIONS = [
  { value: 'low',       label: 'کم' },
  { value: 'normal',    label: 'عادی' },
  { value: 'important', label: 'مهم' },
  { value: 'urgent',    label: 'فوری' },
];

const DECISION_STATUS_OPTIONS = [
  { value: 'not_started',          label: 'شروع‌نشده' },
  { value: 'planned',              label: 'برنامه‌ریزی‌شده' },
  { value: 'in_progress',          label: 'در حال انجام' },
  { value: 'waiting_coordination', label: 'منتظر هماهنگی' },
  { value: 'waiting_approval',     label: 'منتظر تأیید' },
  { value: 'completed',            label: 'تکمیل‌شده' },
  { value: 'stopped',              label: 'متوقف‌شده' },
];
