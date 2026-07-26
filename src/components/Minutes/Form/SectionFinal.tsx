import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import type { DraftFinalization, DraftMeetingInfo, DraftInternalParticipant, DraftExternalParticipant, DraftAgendaItem, DraftDecision, ProfileOption, OrgUnitOption } from './types';
import { InputField, TextareaField } from './fields';
import { MinutesDocumentLayout } from '../MinutesDocumentLayout';
import { buildDocumentDataFromDraft } from '../MinutesDocumentFromDraft';
import type { MinutesDocumentData } from '../MinutesDocumentData';

interface SectionFinalProps {
  finalization: DraftFinalization;
  setFinalization: React.Dispatch<React.SetStateAction<DraftFinalization>>;
  info: DraftMeetingInfo;
  internalParticipants: DraftInternalParticipant[];
  externalParticipants: DraftExternalParticipant[];
  agendaItems: DraftAgendaItem[];
  decisions: DraftDecision[];
  profiles: ProfileOption[];
  orgUnits: OrgUnitOption[];
  logoUrl: string | null;
}

export function SectionFinal({
  finalization, setFinalization,
  info, internalParticipants, externalParticipants, agendaItems, decisions,
  profiles, orgUnits, logoUrl,
}: SectionFinalProps) {
  const [showPreview, setShowPreview] = useState(false);

  const update = (field: keyof DraftFinalization, value: string) =>
    setFinalization(prev => ({ ...prev, [field]: value }));

  const docData: MinutesDocumentData = buildDocumentDataFromDraft(
    info, internalParticipants, externalParticipants, agendaItems, decisions,
    profiles, orgUnits, logoUrl,
  );

  return (
    <div className="space-y-5" dir="rtl">
      <h2 className="text-lg font-bold text-gray-900 dark:text-white border-b border-gray-100 dark:border-gray-700 pb-3">
        نهایی‌سازی و پیش‌نمایش
      </h2>

      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          پیش‌نمایش صورت‌جلسه با اطلاعات فعلی فرم نمایش داده می‌شود.
        </p>
        <button
          onClick={() => setShowPreview(v => !v)}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 text-sm font-medium hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors"
        >
          {showPreview ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          {showPreview ? 'بستن پیش‌نمایش' : 'نمایش پیش‌نمایش'}
        </button>
      </div>

      {showPreview && (
        <div className="minutes-preview-container border border-gray-200 dark:border-gray-700 rounded-2xl overflow-hidden bg-white dark:bg-gray-800">
          <MinutesDocumentLayout data={docData} variant="preview" />
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <InputField id="sign-date" label="تاریخ امضا" placeholder="۱۴۰۳/۰۵/۱۸" value={finalization.signDate} onChange={v => update('signDate', v)} />
        <InputField id="version-number" label="شماره نسخه" placeholder="۱.۰" value={finalization.versionNumber} onChange={v => update('versionNumber', v)} />
        <div className="sm:col-span-2">
          <TextareaField id="version-notes" label="توضیحات نسخه" rows={2} value={finalization.versionNotes} onChange={v => update('versionNotes', v)} />
        </div>
      </div>
    </div>
  );
}
