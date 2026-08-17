import * as XLSX from '../../lib/xlsxCompat';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';
import type { ImportResult } from './types';

async function handleImportFile(
  file: File,
  onDone: (result: ImportResult) => void,
  onFinally: () => void,
): Promise<void> {
  console.log('[IMPORT] Import started');
  console.log('[IMPORT] File received:', file.name);

  const result: ImportResult = { total: 0, created: 0, failed: 0, errors: [] };

  try {
    const data = await file.arrayBuffer();
    const wb = await XLSX.read(data);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
    console.log('[IMPORT] Total rows:', rows.length);

    if (!rows.length) {
      toast.error('فایل خالی است');
      onFinally();
      return;
    }

    const normKey = (s: string) =>
      s.trim()
        .normalize('NFC')
        .replace(/[\u064A\u0649]/g, '\u06CC')
        .replace(/\u0643/g, '\u06A9')
        .replace(/\u0647\u0654/g, '\u06C0')
        .toLowerCase();

    const fileKeys = rows[0] ? Object.keys(rows[0]) : [];
    const normMap = new Map<string, string>();
    fileKeys.forEach(k => normMap.set(normKey(k), k));

    const forbiddenColumns = [
      'ادمین (true/false)', 'is_admin', 'admin',
      'مدیر امنیتی (true/false)', 'is_security_admin', 'security_admin',
      'فعال (true/false)', 'is_active', 'active',
      'account_status', 'security_role_version',
    ];
    const forbiddenFound = forbiddenColumns.filter((candidate) => normMap.has(normKey(candidate)));
    if (forbiddenFound.length > 0) {
      toast.error('فایل شامل ستون‌های محافظت‌شده نقش/وضعیت است. لطفاً قالب جدید را دانلود کنید.');
      onFinally();
      return;
    }

    const cell = (row: Record<string, unknown>, ...candidates: string[]): string => {
      for (const c of candidates) {
        const orig = normMap.get(normKey(c));
        if (orig !== undefined) {
          const v = String(row[orig] ?? '').trim();
          if (v) return v;
        }
      }
      return '';
    };

    const emailColKey = normMap.get(normKey('ایمیل')) ?? normMap.get('email') ?? normMap.get('e-mail');
    if (!emailColKey) {
      console.error('[IMPORT] Email column not found in file');
      toast.error(`ستون «ایمیل» در فایل یافت نشد. ستون‌های موجود: ${fileKeys.slice(0, 5).join(', ')}`);
      onFinally();
      return;
    }

    result.total = rows.length;

    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) {
      toast.error('جلسه کاربر منقضی شده — لطفاً دوباره وارد شوید');
      onFinally();
      return;
    }

    const str = (v: string): string | null => v.trim() || null;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] as Record<string, unknown>;
      const rowNum = i + 2;

      const email = String(row[emailColKey] ?? '').trim().toLowerCase();
      const passwordRaw = cell(row, 'رمز عبور', 'password', 'Password');
      const password = passwordRaw || 'Ss123456';

      if (!email) {
        result.failed++;
        result.errors.push({ row: rowNum, email: '', reason: 'مقدار ستون ایمیل خالی است' });
        continue;
      }

      const payload = {
        email,
        password,
        profile: {
          full_name:    str(cell(row, 'نام و نام خانوادگی', 'full_name', 'name')),
          username:     str(cell(row, 'نام کاربری', 'username')),
          phone:        str(cell(row, 'شماره موبایل', 'phone', 'mobile')),
          national_id:  str(cell(row, 'کد ملی', 'national_id')),
          employee_id:  str(cell(row, 'کد پرسنلی', 'employee_id')),
          gender:       str(cell(row, 'جنسیت (male/female)', 'جنسیت', 'gender')),
          birth_date:   str(cell(row, 'تاریخ تولد', 'birth_date')),
          city:         str(cell(row, 'شهر', 'city')),
          organization: str(cell(row, 'سازمان', 'organization')),
          position:     str(cell(row, 'سمت', 'position')),
          department:   str(cell(row, 'واحد', 'department')),
          hire_date:    str(cell(row, 'تاریخ استخدام', 'hire_date')),
          location:     str(cell(row, 'موقعیت مکانی', 'location')),
          bio:          str(cell(row, 'درباره کاربر', 'bio')),
        },
      };

      try {
        const res = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-users/create`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`,
              'Apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
            },
            body: JSON.stringify(payload),
          }
        );

        const json = await res.json();
        if (!res.ok || json.error) {
          result.failed++;
          result.errors.push({ row: rowNum, email, reason: json.error || `HTTP ${res.status}` });
        } else {
          result.created++;
        }
      } catch (err: any) {
        console.error('[IMPORT] Row', rowNum, 'network error:', err.message);
        result.failed++;
        result.errors.push({ row: rowNum, email, reason: err.message || 'خطای شبکه' });
      }
    }

    console.log('[IMPORT] Import finished — total:', result.total, '| created:', result.created, '| failed:', result.failed);
    onDone(result);
  } catch (err: any) {
    console.error('[IMPORT] Failed to process file:', err.message);
    toast.error('خطا در پردازش فایل: ' + err.message);
  } finally {
    onFinally();
  }
}

export { handleImportFile };
