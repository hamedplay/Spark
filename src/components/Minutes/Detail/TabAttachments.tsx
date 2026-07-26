import { useEffect, useState } from 'react';
import { Paperclip, Loader as Loader2, Trash2, Download, CloudUpload as UploadCloud } from 'lucide-react';
import toast from 'react-hot-toast';
import { EmptyState, TableSkeleton, ConfirmActionDialog } from '../MinutesShared';
import {
  listMinuteAttachments, uploadMinuteAttachment, deleteMinuteAttachment, getAttachmentDownloadUrl,
  validateAttachment, formatBytes, type AttachmentRow,
} from '../../../lib/minutesAttachments';

export interface TabAttachmentsProps {
  minuteId: string;
  canManage: boolean;
}

export function TabAttachments({ minuteId, canManage }: TabAttachmentsProps) {
  const [attachments, setAttachments] = useState<AttachmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState<AttachmentRow | null>(null);
  const [progress, setProgress] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState<AttachmentRow | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [fileInput, setFileInput] = useState<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const load = async () => {
    setLoading(true); setError(null);
    try { setAttachments(await listMinuteAttachments(minuteId)); }
    catch (e) { setError(e instanceof Error ? e.message : 'بارگذاری پیوست‌ها ناموفق بود.'); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [minuteId]);

  const handleFiles = async (files: FileList | File[]) => {
    if (!canManage) return;
    const arr = Array.from(files);
    for (const f of arr) {
      const v = validateAttachment(f);
      if (!v.ok) { toast.error(`${f.name}: ${v.error}`); continue; }
      setUploading(null); setProgress(0);
      try {
        const { attachment } = await uploadMinuteAttachment(f, {
          minuteId,
          onProgress: setProgress,
        });
        setAttachments(prev => [...prev, attachment]);
        toast.success(`${f.name} بارگذاری شد.`);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'بارگذاری ناموفق بود.');
      }
    }
    setProgress(0);
    if (fileInput) fileInput.value = '';
  };

  const handleDownload = async (a: AttachmentRow) => {
    setDownloading(a.id);
    try {
      const url = await getAttachmentDownloadUrl(a.id);
      const link = document.createElement('a');
      link.href = url;
      link.download = a.original_filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'دانلود ناموفق بود.');
    } finally { setDownloading(null); }
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    try {
      await deleteMinuteAttachment(confirmDelete.id);
      setAttachments(prev => prev.filter(x => x.id !== confirmDelete.id));
      toast.success('پیوست حذف شد.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'حذف ناموفق بود.');
    } finally { setConfirmDelete(null); }
  };

  if (loading) return <TableSkeleton rows={3} />;
  if (error) return <div className="bg-red-50 dark:bg-red-900/20 rounded-xl p-4 text-sm text-red-600 dark:text-red-400">{error}</div>;

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-gray-900 dark:text-white">پیوست‌ها</h2>
        {canManage && (
          <button
            onClick={() => fileInput?.click()}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white transition-colors"
          >
            <UploadCloud className="w-4 h-4" />
            افزودن فایل
          </button>
        )}
      </div>
      <input
        ref={el => setFileInput(el)}
        type="file"
        multiple
        className="hidden"
        accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.jpg,.jpeg,.png,.webp,.txt,.zip"
        onChange={e => e.target.files && handleFiles(e.target.files)}
      />

      {progress > 0 && (
        <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
          <div className="h-2 bg-blue-600 rounded-full transition-all" style={{ width: `${progress}%` }} />
        </div>
      )}

      {attachments.length === 0 ? (
        <EmptyState icon={<Paperclip className="w-8 h-8" />} title="هیچ پیوستی وجود ندارد" description={canManage ? 'برای افزودن فایل روی «افزودن فایل» بزنید.' : undefined} />
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50">
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500">نام فایل</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500">حجم</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500">بارگذارنده</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500">تاریخ</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500">عملیات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
              {attachments.map(a => (
                <tr key={a.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/40">
                  <td className="px-4 py-3 text-gray-700 dark:text-gray-300 max-w-xs truncate" title={a.original_filename}>{a.original_filename}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">{formatBytes(a.size_bytes)}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">{a.uploader_name || '—'}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">{new Date(a.created_at).toLocaleDateString('fa-IR')}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleDownload(a)}
                        disabled={downloading === a.id}
                        className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50"
                        title="دانلود"
                      >
                        {downloading === a.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                      </button>
                      {canManage && (
                        <button
                          onClick={() => setConfirmDelete(a)}
                          className="p-1.5 rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
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

      {confirmDelete && (
        <ConfirmActionDialog
          title="حذف پیوست"
          message={`آیا از حذف «${confirmDelete.original_filename}» مطمئن هستید؟`}
          confirmLabel="حذف"
          danger
          onConfirm={handleDelete}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}
