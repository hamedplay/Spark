import { useState, useRef } from 'react';
import { Eye, EyeOff, Signature as FileSignature, CloudUpload as UploadCloud, Loader as Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import type { DraftFinalization, DraftMeetingInfo, DraftInternalParticipant, DraftExternalParticipant, DraftAgendaItem, DraftDecision, ProfileOption, OrgUnitOption } from './types';
import { InputField, TextareaField } from './fields';
import { MinutesDocumentLayout } from '../MinutesDocumentLayout';
import { buildDocumentDataFromDraft } from '../MinutesDocumentFromDraft';
import type { MinutesDocumentData } from '../MinutesDocumentData';
import { uploadMinuteAttachment, validateAttachment, type AttachmentRow } from '../../../lib/minutesAttachments';

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
  minuteId: string | null;
  canManage: boolean;
}

export function SectionFinal({
  finalization, setFinalization,
  info, internalParticipants, externalParticipants, agendaItems, decisions,
  profiles, orgUnits, logoUrl, minuteId, canManage,
}: SectionFinalProps) {
  const [showPreview, setShowPreview] = useState(false);
  const [uploadingSigned, setUploadingSigned] = useState(false);
  const [signedProgress, setSignedProgress] = useState(0);
  const [signedFiles, setSignedFiles] = useState<AttachmentRow[]>([]);
  const signedInputRef = useRef<HTMLInputElement | null>(null);

  const update = (field: keyof DraftFinalization, value: string) =>
    setFinalization(prev => ({ ...prev, [field]: value }));

  const handleSignedFile = async (files: FileList | File[]) => {
    if (!canManage || !minuteId) return;
    const arr = Array.from(files);
    if (arr.length === 0) return;
    const f = arr[0];
    const v = validateAttachment(f);
    if (!v.ok) { toast.error(`${f.name}: ${v.error}`); return; }
    setUploadingSigned(true);
    setSignedProgress(0);
    try {
      const { attachment } = await uploadMinuteAttachment(f, {
        minuteId,
        attachmentKind: 'signed_final',
        revisionNumber: info.revisionNumber ?? null,
        onProgress: setSignedProgress,
      });
      setSignedFiles(prev => [...prev, attachment]);
      toast.success('نسخه امضاشده بارگذاری شد.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'بارگذاری نسخه امضاشده ناموفق بود.');
    } finally {
      setUploadingSigned(false);
      setSignedProgress(0);
      if (signedInputRef.current) signedInputRef.current.value = '';
    }
  };

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

      {canManage && minuteId && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-2xl p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <FileSignature className="w-5 h-5 text-amber-600 dark:text-amber-400" />
              <div>
                <h3 className="text-sm font-bold text-amber-800 dark:text-amber-300">نسخه نهایی امضاشده</h3>
                <p className="text-xs text-amber-600 dark:text-amber-400">فایل امضاشده این صورت‌جلسه را بارگذاری کنید. نسخه‌های قبلی حفظ می‌شوند.</p>
              </div>
            </div>
            <button
              onClick={() => signedInputRef.current?.click()}
              disabled={uploadingSigned}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-amber-600 hover:bg-amber-700 text-white transition-colors disabled:opacity-50"
            >
              {uploadingSigned ? <Loader2 className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}
              بارگذاری نسخه امضاشده
            </button>
          </div>
          <input
            ref={signedInputRef}
            type="file"
            className="hidden"
            accept=".pdf,.jpg,.jpeg,.png,.webp"
            onChange={e => e.target.files && handleSignedFile(e.target.files)}
          />
          {uploadingSigned && signedProgress > 0 && (
            <div className="mt-3 w-full bg-amber-200 dark:bg-amber-800 rounded-full h-2">
              <div className="h-2 bg-amber-600 rounded-full transition-all" style={{ width: `${signedProgress}%` }} />
            </div>
          )}
          {signedFiles.length > 0 && (
            <div className="mt-3 space-y-1">
              {signedFiles.map(f => (
                <div key={f.id} className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-400">
                  <FileSignature className="w-3 h-3" />
                  <span>{f.original_filename}</span>
                  {f.revision_number != null && <span>— نسخه {f.revision_number}</span>}
                </div>
              ))}
            </div>
          )}
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
