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

export type AttachmentKind = 'general' | 'signed_final';

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
  if (declared === 'image/jpg' && expected === 'image/jpeg') return true;
  if (declared === 'application/octet-stream' || declared === '') return true;
  if (expected === 'application/zip' && declared === 'application/x-zip-compressed') return true;
  return false;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} بایت`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} کیلوبایت`;
  return `${(n / (1024 * 1024)).toFixed(1)} مگابایت`;
}
