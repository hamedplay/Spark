import { useState, useEffect, useRef } from 'react';
import { Upload, Download, Trash2, Signature as FileSignature, Loader as Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  listMinuteAttachments, uploadMinuteAttachment, deleteMinuteAttachment,
  getAttachmentDownloadUrl, formatBytes,
  type AttachmentRow,
} from '../../../lib/minutesAttachments';
import { TableSkeleton } from '../MinutesShared';

interface Props {
  minuteId: string;
  revisionNumber: number;
  canManage: boolean;
}

export function TabFinalVersion({ minuteId, revisionNumber, canManage }: Props) {
  const [attachments, setAttachments] = useState<AttachmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    try {
      setError(null);
      const rows = await listMinuteAttachments(minuteId);
      setAttachments(rows.filter(r => r.attachment_kind === 'signed_final'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطا در بارگذاری');
    } finally {
      setLoading(false);
    }
  };

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
      await load();
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

  const handleDelete = async (id: string) => {
    if (!window.confirm('آیا از حذف این فایل مطمئن هستید؟')) return;
    setDeletingId(id);
    try {
      await deleteMinuteAttachment(id);
      toast.success('فایل حذف شد.');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'حذف ناموفق بود.');
    } finally {
      setDeletingId(null);
    }
  };

  if (loading) return <TableSkeleton rows={3} />;

  return (
    <div className="space-y-5" dir="rtl">
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
                          onClick={() => handleDelete(a.id)}
                          disabled={deletingId === a.id}
                          className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-red-400 transition-colors disabled:opacity-50"
                          title="حذف"
                        >
                          {deletingId === a.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
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
  );
}
