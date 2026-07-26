import { UserCheck, Bell, Video, MessageSquare, Save, Loader as Loader2, CirclePlus as PlusCircle } from 'lucide-react';
import type { ContactEmail } from '../../types';
import { RepresentativeField } from './RepresentativeField';

export function MeetingCoreFields(props: {
  subject: string;
  setSubject: (v: string) => void;
  location: string;
  setLocation: (v: string) => void;
  repPickerRef: React.RefObject<HTMLDivElement | null>;
  representative: string;
  setRepresentative: (v: string) => void;
  setRepFromContacts: (v: boolean) => void;
  showRepPicker: boolean;
  setShowRepPicker: (v: boolean) => void;
  setRepPickerSearch: (v: string) => void;
  repPickerSearch: string;
  allContacts: ContactEmail[];
  setPhone: (v: string) => void;
  phone: string;
  priority: string;
  setPriority: (v: string) => void;
  notes: string;
  setNotes: (v: string) => void;
}) {
  const {
    subject, setSubject, location, setLocation,
    repPickerRef, representative, setRepresentative, setRepFromContacts,
    showRepPicker, setShowRepPicker, setRepPickerSearch, repPickerSearch,
    allContacts, setPhone, phone, priority, setPriority, notes, setNotes,
  } = props;

  return (
    <>
      {/* Subject */}
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">موضوع جلسه</label>
        <input required type="text" value={subject} onChange={e => setSubject(e.target.value)}
          className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">محل برگزاری</label>
          <input required type="text" value={location} onChange={e => setLocation(e.target.value)}
            className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white" />
        </div>
        <RepresentativeField
          repPickerRef={repPickerRef}
          representative={representative}
          setRepresentative={setRepresentative}
          setRepFromContacts={setRepFromContacts}
          showRepPicker={showRepPicker}
          setShowRepPicker={setShowRepPicker}
          setRepPickerSearch={setRepPickerSearch}
          repPickerSearch={repPickerSearch}
          allContacts={allContacts}
          setPhone={setPhone}
          phone={phone}
        />
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">شماره تماس</label>
          <input required type="tel" value={phone} onChange={e => { setPhone(e.target.value); setRepFromContacts(false); }}
            className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">اولویت</label>
          <select value={priority} onChange={e => setPriority(e.target.value)}
            className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white">
            <option value="high">بالا</option>
            <option value="medium">متوسط</option>
            <option value="low">پایین</option>
          </select>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">یادداشت‌ها</label>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
          className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white resize-none" />
      </div>
    </>
  );
}

export function MeetingManagerField(props: {
  hasParticipants: boolean;
  meetingManager: string;
  setMeetingManager: (v: string) => void;
  participantDisplayItems: { id: string; name: string }[];
  managerDisplayName: string;
}) {
  const { hasParticipants, meetingManager, setMeetingManager, participantDisplayItems, managerDisplayName } = props;
  if (!hasParticipants) return null;

  return (
    <div>
      <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
        <UserCheck className="w-4 h-4" />مدیر جلسه
      </label>
      <select value={meetingManager} onChange={e => setMeetingManager(e.target.value)}
        className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white">
        <option value="">بدون مدیر</option>
        {participantDisplayItems.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      {meetingManager && managerDisplayName && (
        <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">{managerDisplayName}</div>
      )}
    </div>
  );
}

export function ReminderField(props: {
  reminderMinutes: number;
  setReminderMinutes: (v: number) => void;
}) {
  const { reminderMinutes, setReminderMinutes } = props;
  return (
    <div>
      <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
        <Bell className="w-4 h-4" />یادآوری
      </label>
      <select value={reminderMinutes} onChange={e => setReminderMinutes(Number(e.target.value))}
        className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white">
        <option value={0}>بدون یادآوری</option>
        <option value={5}>5 دقیقه قبل</option>
        <option value={10}>10 دقیقه قبل</option>
        <option value={15}>15 دقیقه قبل</option>
        <option value={30}>30 دقیقه قبل</option>
        <option value={60}>1 ساعت قبل</option>
        <option value={1440}>1 روز قبل</option>
      </select>
    </div>
  );
}

export function OnlineMeetingToggle(props: {
  isOnline: boolean;
  setIsOnline: (fn: (v: boolean) => boolean) => void;
}) {
  const { isOnline, setIsOnline } = props;
  return (
    <div className={`flex items-center justify-between gap-3 p-3.5 rounded-xl border transition-colors ${isOnline ? 'bg-sky-50 dark:bg-sky-900/20 border-sky-200 dark:border-sky-700' : 'bg-gray-50 dark:bg-gray-700/30 border-gray-200 dark:border-gray-600'}`}>
      <div className="flex items-center gap-3">
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${isOnline ? 'bg-sky-500' : 'bg-gray-300 dark:bg-gray-600'}`}>
          <Video className="w-4 h-4 text-white" />
        </div>
        <div>
          <p className={`text-sm font-medium ${isOnline ? 'text-sky-800 dark:text-sky-200' : 'text-gray-700 dark:text-gray-300'}`}>
            این جلسه به صورت آنلاین برگزار می‌گردد
          </p>
          <p className={`text-xs mt-0.5 ${isOnline ? 'text-sky-600 dark:text-sky-400' : 'text-gray-400 dark:text-gray-500'}`}>
            {isOnline ? 'اتاق ویدیو کنفرانس اتوماتیک ایجاد می‌شود' : 'غیرفعال — جلسه حضوری'}
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={() => setIsOnline(v => !v)}
        className={`relative w-12 h-6 rounded-full transition-colors flex-shrink-0 ${isOnline ? 'bg-sky-500' : 'bg-gray-300 dark:bg-gray-600'}`}
      >
        <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${isOnline ? 'translate-x-6' : 'translate-x-0.5'}`} />
      </button>
    </div>
  );
}

export function SmsAndSaveToggle(props: {
  sendSms: boolean;
  setSendSms: (v: boolean) => void;
  repFromContacts: boolean;
  representative: string;
  saveContact: boolean;
  setSaveContact: (v: boolean) => void;
}) {
  const { sendSms, setSendSms, repFromContacts, representative, saveContact, setSaveContact } = props;
  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={sendSms} onChange={e => setSendSms(e.target.checked)} className="w-4 h-4 rounded text-blue-600" />
        <span className="text-sm text-gray-700 dark:text-gray-300 flex items-center gap-1.5"><MessageSquare className="w-4 h-4" />ارسال پیامک</span>
      </label>
      {!repFromContacts && representative.trim() && (
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={saveContact} onChange={e => setSaveContact(e.target.checked)} className="w-4 h-4 rounded text-blue-600" />
          <span className="text-sm text-gray-700 dark:text-gray-300 flex items-center gap-1.5"><Save className="w-4 h-4" />ذخیره اطلاعات تماس در دفترچه</span>
        </label>
      )}
    </div>
  );
}

export function MeetingFormFooter(props: {
  loading: boolean;
  orgUsersLoading: boolean;
  committing: boolean;
  editDecision: unknown;
  onCancel: () => void;
}) {
  const { loading, orgUsersLoading, committing, editDecision, onCancel } = props;
  return (
    <div className="flex gap-2 px-5 py-4 border-t border-gray-100 dark:border-gray-700 flex-shrink-0">
      <button type="submit" disabled={loading || orgUsersLoading || committing || !!editDecision}
        className="flex-1 flex items-center justify-center gap-2 bg-teal-600 text-white py-2.5 rounded-xl hover:bg-teal-700 disabled:opacity-50 font-medium text-sm transition-colors">
        {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <PlusCircle className="w-5 h-5" />}
        ثبت نهایی جلسه
      </button>
      <button type="button" onClick={onCancel}
        className="px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-xl text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 text-sm font-medium transition-colors">
        انصراف
      </button>
    </div>
  );
}
