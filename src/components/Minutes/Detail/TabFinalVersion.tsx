import { useState, useEffect, useRef } from 'react';
import { Upload, Download, Trash2, Signature as FileSignature, Loader as Loader2, Maximize2, RefreshCw, FileDown, Printer } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  listMinuteAttachments, uploadMinuteAttachment, deleteMinuteAttachment,
  getAttachmentDownloadUrl, formatBytes,
  type AttachmentRow,
} from '../../../lib/minutesAttachments';
import { TableSkeleton, ConfirmActionDialog } from '../MinutesShared';
import { MinutesDocumentLayout } from '../MinutesDocumentLayout';
import type { MinutesDocumentData } from '../MinutesDocumentData';
import { FullScreenPreview } from '../Shared/FullScreenPreview';

interface Props {
  minuteId: string;
  revisionNumber: number;
  canManage: boolean;
  docData: MinutesDocumentData | null;
  docDataLoading: boolean;
  docDataError: string | null;
  onPrepareDocumentData: () => Promise<MinutesDocumentData>;
  onPrint: () => void;
  onWordExport: () => void;
  wordLoading: boolean;
  printLoading?: boolean;
}

export function TabFinalVersion({ minuteId, revisionNumber, canManage, docData, docDataLoading, docDataError, onPrepareDocumentData, onPrint, onWordExport, wordLoading, printLoading }: Props) {
  const [attachments, setAttachments] = useState<AttachmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showFullPreview, setShowFullPreview] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setError(null);
        const rows = await listMinuteAttachments(minuteId);
        if (!cancelled) setAttachments(rows.filter(r => r.attachment_kind === 'signed_final'));
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'خطا در بارگذاری');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [minuteId]);

  const reload = async () => {
    try {
      const rows = await listMinuteAttachments(minuteId);
      setAttachments(rows.filter(r => r.attachment_kind === 'signed_final'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطا در بارگذاری');
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      await uploadMinuteAttachment(file, {
        minuteId,
        attachmentKind: 'signed_final',
        revisionNumber,
      });
      toast.success('نسخه امضاشده بارگذاری شد.');
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'بارگذاری ناموفق بود.');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleDownload = async (id: string, filename: string) => {
    setDownloadingId(id);
    try {
      const url = await getAttachmentDownloadUrl(id);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'دانلود ناموفق بود.');
    } finally {
      setDownloadingId(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeletingId(deleteTarget);
    try {
      await deleteMinuteAttachment(deleteTarget);
      toast.success('فایل حذف شد.');
      setDeleteTarget(null);
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'حذف ناموفق بود.');
    } finally {
      setDeletingId(null);
    }
  };

  if (loading) return <TableSkeleton rows={3} />;

  return (
    <div className="space-y-5" dir="rtl">
      {/* Full document preview */}
      {docDataError ? (
        <div className="space-y-3">
          <div className="bg-red-50 dark:bg-red-900/20 rounded-xl p-4 text-sm text-red-600 dark:text-red-400">
            {docDataError}
          </div>
          <button
            onClick={() => onPrepareDocumentData()}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            تلاش مجدد
          </button>
        </div>
      ) : docDataLoading ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold text-gray-900 dark:text-white">پیش‌نمایش صورت‌جلسه</h3>
            <button
              disabled
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-white bg-blue-400 cursor-not-allowed"
            >
              <Loader2 className="w-4 h-4 animate-spin" />
              پیش‌نمایش تمام‌صفحه
            </button>
          </div>
          <TableSkeleton rows={6} />
        </div>
      ) : docData ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold text-gray-900 dark:text-white">پیش‌نمایش صورت‌جلسه</h3>
            <button
              onClick={() => setShowFullPreview(true)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 transition-colors"
            >
              <Maximize2 className="w-4 h-4" />
              پیش‌نمایش تمام‌صفحه
            </button>
            <button
              onClick={onPrint}
              disabled={printLoading}
              aria-label="چاپ / ذخیره PDF"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-white bg-gray-600 hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Printer className="w-4 h-4" />
              چاپ / ذخیره PDF
            </button>
            <button
              onClick={onWordExport}
              disabled={wordLoading || !docData}
              aria-label="خروجی Word"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {wordLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
              {wordLoading ? 'در حال ساخت Word...' : 'خروجی Word'}
            </button>
          </div>
          <div className="border border-gray-200 dark:border-gray-700 rounded-2xl overflow-hidden bg-white dark:bg-gray-800">
            <MinutesDocumentLayout data={docData} variant="preview" />
          </div>
        </div>
      ) : null}

      {docData && (
        <FullScreenPreview
          open={showFullPreview}
          onClose={() => setShowFullPreview(false)}
          docData={docData}
          onPrint={onPrint}
          onWordExport={onWordExport}
          wordLoading={wordLoading}
        />
      )}

      {/* Signed version uploads */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900 dark:text-white">نسخه‌های امضاشده</h3>
          {canManage && (
            <label className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors cursor-pointer ${uploading ? 'bg-gray-100 text-gray-400 dark:bg-gray-700 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700 text-white'}`}>
              {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              {uploading ? 'در حال بارگذاری...' : 'بارگذاری نسخه امضاشده'}
              <input
                ref={fileRef}
                type="file"
                className="sr-only"
                disabled={uploading}
                accept=".pdf,.jpg,.jpeg,.png,.docx,.doc"
                onChange={handleUpload}
              />
            </label>
          )}
        </div>

        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 rounded-xl p-3 text-sm text-red-600 dark:text-red-400">{error}</div>
        )}

        {attachments.length === 0 ? (
          <div className="text-center py-10 text-sm text-gray-400 dark:text-gray-500">
            <FileSignature className="w-8 h-8 mx-auto mb-2 opacity-40" />
            هنوز نسخه امضاشده‌ای بارگذاری نشده است.
          </div>
        ) : (
          <div className="rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50">
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500">نام فایل</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500">حجم</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500">بارگذار</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500">تاریخ</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500">ویرایش</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500">عملیات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
                {attachments.map(a => (
                  <tr key={a.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                    <td className="px-4 py-3 text-gray-800 dark:text-gray-200">{a.original_filename}</td>
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{formatBytes(a.size_bytes)}</td>
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{a.uploader_name || '—'}</td>
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap text-xs">
                      {new Date(a.created_at).toLocaleDateString('fa-IR')}
                    </td>
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap text-xs">{a.revision_number ?? '—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleDownload(a.id, a.original_filename)}
                          disabled={downloadingId === a.id}
                          className="p-1.5 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 text-blue-500 transition-colors disabled:opacity-50"
                          title="دانلود"
                        >
                          {downloadingId === a.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                        </button>
                        {canManage && (
                          <button
                            onClick={() => setDeleteTarget(a.id)}
                            className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-red-400 transition-colors"
                            title="حذف"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {deleteTarget && (
        <ConfirmActionDialog
          title="حذف فایل امضاشده"
          message="آیا از حذف این فایل مطمئن هستید؟"
          confirmLabel={deletingId ? 'در حال حذف...' : 'حذف'}
          onConfirm={handleDelete}
          onCancel={() => !deletingId && setDeleteTarget(null)}
          danger
        />
      )}
    </div>
  );
}
