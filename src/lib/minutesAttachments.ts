import { supabase } from './supabase';

export const ATTACHMENT_BUCKET = 'minutes-attachments';
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024; // 20 MB

export const ALLOWED_EXTENSIONS = new Set([
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  'jpg', 'jpeg', 'png', 'webp', 'txt', 'zip',
]);

const EXT_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  txt: 'text/plain',
  zip: 'application/zip',
};

export interface AttachmentRow {
  id: string;
  minute_id: string;
  agenda_result_id: string | null;
  decision_id: string | null;
  storage_path: string;
  original_filename: string;
  stored_filename: string;
  mime_type: string;
  size_bytes: number;
  uploaded_by_user_id: string;
  description: string | null;
  created_at: string;
  uploader_name?: string | null;
}

export interface ValidationResult {
  ok: boolean;
  error?: string;
  ext?: string;
  mime?: string;
}

export function validateAttachment(file: File): ValidationResult {
  if (file.size <= 0) return { ok: false, error: 'فایل خالی است.' };
  if (file.size > MAX_ATTACHMENT_BYTES) return { ok: false, error: 'حجم فایل بیش از ۲۰ مگابایت است.' };
  const lower = file.name.toLowerCase();
  const dot = lower.lastIndexOf('.');
  if (dot < 0) return { ok: false, error: 'پسوند فایل مشخص نیست.' };
  const ext = lower.slice(dot + 1);
  if (!ALLOWED_EXTENSIONS.has(ext)) return { ok: false, error: `پسوند «${ext}» مجاز نیست.` };
  const expectedMime = EXT_MIME[ext];
  const declaredMime = (file.type || '').toLowerCase();
  if (declaredMime && expectedMime && !mimesCompatible(declaredMime, expectedMime)) {
    return { ok: false, error: 'نوع MIME فایل با پسوند آن همخوانی ندارد.' };
  }
  return { ok: true, ext, mime: expectedMime || declaredMime };
}

function mimesCompatible(declared: string, expected: string): boolean {
  if (declared === expected) return true;
  // image/jpeg and image/jpg are interchangeable
  if (declared === 'image/jpg' && expected === 'image/jpeg') return true;
  // some browsers report generic types for office docs; accept if extension is in office family
  if (declared === 'application/octet-stream' || declared === '') return true;
  // allow generic zip for zip
  if (expected === 'application/zip' && declared === 'application/x-zip-compressed') return true;
  return false;
}

function sanitizeFilename(name: string): string {
  // Keep persian letters, digits, dot, dash, underscore; replace the rest with _
  const base = name.replace(/[\s]+/g, '_');
  const cleaned = base.replace(/[^\p{L}\p{N}._-]/gu, '_');
  return cleaned.slice(0, 120) || 'file';
}

export interface UploadOptions {
  minuteId: string;
  agendaResultId?: string | null;
  decisionId?: string | null;
  description?: string | null;
  onProgress?: (pct: number) => void;
}

export interface UploadResult {
  attachment: AttachmentRow;
}

export async function uploadMinuteAttachment(
  file: File,
  opts: UploadOptions,
): Promise<UploadResult> {
  const v = validateAttachment(file);
  if (!v.ok) throw new Error(v.error || 'فایل نامعتبر است.');

  // 1. Call Edge Function: validates JWT, runs begin RPC (derives path), creates signed upload URL server-side.
  const { data: session } = await supabase.auth.getSession();
  const token = session?.session?.access_token;
  if (!token) throw new Error('برای بارگذاری پیوست باید وارد شوید.');

  const efRes = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/minutes-attachment-upload`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      minute_id: opts.minuteId,
      agenda_result_id: opts.agendaResultId ?? null,
      decision_id: opts.decisionId ?? null,
      original_filename: file.name.trim(),
      mime_type: v.mime || file.type || 'application/octet-stream',
      size_bytes: file.size,
      description: opts.description ?? null,
    }),
  });
  if (!efRes.ok) {
    const errBody = await efRes.json().catch(() => ({}));
    throw new Error(translateRpcError(errBody.error) || `بارگذاری ناموفق بود (${efRes.status})`);
  }
  const begin = await efRes.json() as { attachment_id: string; storage_path: string; signed_url: string };
  const attachmentId = begin.attachment_id;
  const storagePath = begin.storage_path;

  // 2. Upload bytes to the signed URL returned by the Edge Function.
  const upRes = await fetch(begin.signed_url, {
    method: 'PUT',
    body: file,
    headers: { 'Content-Type': v.mime || file.type || 'application/octet-stream' },
  });
  if (!upRes.ok) {
    throw new Error('بارگذاری فایل ناموفق بود: ' + upRes.status);
  }

  // 3. Finalize: backend verifies object exists + size matches, sets ready, writes audit.
  const { error: finErr } = await supabase.rpc('finalize_minutes_attachment', {
    p_attachment_id: attachmentId,
  });
  if (finErr) {
    // Finalize failed; best-effort remove the uploaded object to avoid orphan.
    try { await supabase.storage.from(ATTACHMENT_BUCKET).remove([storagePath]); } catch { /* ignore */ }
    throw new Error(translateRpcError(finErr.message));
  }

  // 4. Fetch the created row.
  const { data: row, error: selErr } = await supabase
    .from('minutes_attachments')
    .select('id,minute_id,agenda_result_id,decision_id,storage_path,original_filename,stored_filename,mime_type,size_bytes,uploaded_by_user_id,description,created_at')
    .eq('id', attachmentId)
    .maybeSingle();
  if (selErr || !row) throw new Error('ساخت رکورد پیوست موفق بود اما بارگذاری اطلاعات ناموفق بود.');
  return { attachment: row as unknown as AttachmentRow };
}

function translateRpcError(msg?: string): string {
  if (!msg) return 'ساخت رکورد پیوست ناموفق بود.';
  if (msg.includes('NOT_AUTHORIZED')) return 'شما اجازه بارگذاری پیوست در این صورت‌جلسه را ندارید.';
  if (msg.includes('PUBLISHED_LOCKED')) return 'صورت‌جلسه منتشرشده است؛ بارگذاری فقط توسط دبیر/رئیس/مدیر ممکن است.';
  if (msg.includes('TARGET_MISMATCH')) return 'بند یا مصوبه انتخاب‌شده متعلق به این صورت‌جلسه نیست.';
  if (msg.includes('INVALID_SIZE')) return 'حجم فایل نامعتبر است.';
  if (msg.includes('INVALID_INPUT')) return 'نام فایل یا اطلاعات نامعتبر است.';
  return 'ساخت رکورد پیوست ناموفق بود.';
}

export async function listMinuteAttachments(minuteId: string): Promise<AttachmentRow[]> {
  const { data, error } = await supabase
    .from('minutes_attachments')
    .select('id,minute_id,agenda_result_id,decision_id,storage_path,original_filename,stored_filename,mime_type,size_bytes,uploaded_by_user_id,description,created_at')
    .eq('minute_id', minuteId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true });
  if (error) throw new Error('بارگذاری پیوست‌ها ناموفق بود.');
  const rows = (data || []) as unknown as AttachmentRow[];
  // Enrich with uploader names
  const ids = Array.from(new Set(rows.map(r => r.uploaded_by_user_id).filter(Boolean)));
  if (ids.length) {
    const { data: prof } = await supabase
      .from('profiles')
      .select('user_id,full_name')
      .in('user_id', ids);
    const map: Record<string, string> = {};
    for (const p of (prof || []) as unknown as { user_id: string; full_name: string }[]) {
      map[p.user_id] = p.full_name;
    }
    for (const r of rows) r.uploader_name = map[r.uploaded_by_user_id] || null;
  }
  return rows;
}

export async function deleteMinuteAttachment(attachmentId: string): Promise<void> {
  const { data: row, error: selErr } = await supabase
    .from('minutes_attachments')
    .select('storage_path')
    .eq('id', attachmentId)
    .maybeSingle();
  if (selErr || !row) throw new Error('پیوست یافت نشد.');
  const storagePath = (row as { storage_path: string }).storage_path;

  // 1. Remove storage object FIRST. If this fails, record stays active, error shown.
  const { error: rmErr } = await supabase.storage.from(ATTACHMENT_BUCKET).remove([storagePath]);
  if (rmErr) throw new Error('حذف فایل ناموفق بود: ' + rmErr.message);

  // 2. Only after successful storage removal, soft-delete the record via RPC.
  const { error } = await supabase.rpc('delete_minutes_attachment', { p_attachment_id: attachmentId });
  if (error) throw new Error(translateDeleteError(error.message));
}

function translateDeleteError(msg: string): string {
  if (msg.includes('NOT_AUTHORIZED')) return 'شما اجازه حذف این پیوست را ندارید.';
  if (msg.includes('NOT_FOUND')) return 'پیوست یافت نشد.';
  return 'حذف پیوست ناموفق بود.';
}

export async function getAttachmentDownloadUrl(attachmentId: string): Promise<string> {
  const { data, error } = await supabase.rpc('get_minutes_attachment_signed_url', {
    p_attachment_id: attachmentId,
  });
  if (error) throw new Error(translateSignedError(error.message));
  const path = data as string;
  const { data: urlData, error: urlErr } = await supabase.storage
    .from(ATTACHMENT_BUCKET)
    .createSignedUrl(path, 300);
  if (urlErr || !urlData?.signedUrl) throw new Error('ساخت لینک دانلود ناموفق بود.');
  return urlData.signedUrl;
}

function translateSignedError(msg: string): string {
  if (msg.includes('NOT_AUTHORIZED')) return 'شما اجازه دانلود این پیوست را ندارید.';
  if (msg.includes('NOT_FOUND')) return 'پیوست یافت نشد.';
  return 'ساخت لینک دانلود ناموفق بود.';
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} بایت`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} کیلوبایت`;
  return `${(n / (1024 * 1024)).toFixed(1)} مگابایت`;
}
