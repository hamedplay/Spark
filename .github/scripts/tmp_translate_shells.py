#!/usr/bin/env python3
from pathlib import Path
import re
import time
from deep_translator import GoogleTranslator

ROOT = Path('deploy/spark-cli')
ARABIC = re.compile(r'[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff]')
ARABIC_SEGMENT = re.compile(r'[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff\u200c\s،؛؟]+')
DIGIT_TRANS = str.maketrans('۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩', '01234567890123456789')
PUNCT_TRANS = str.maketrans({'،': ',', '؛': ';', '؟': '?'})
MANUAL = {
    'به': 'to', 'در': 'in', 'از': 'from', 'و': 'and', 'با': 'with', 'برای': 'for',
    'روی': 'on', 'یا': 'or', 'که': 'that', 'اگر': 'if', 'این': 'this', 'آن': 'that',
    'همان': 'the same', 'فقط': 'only', 'هنوز': 'still', 'قبل': 'before', 'بعد': 'after',
    'بدون': 'without', 'تمام': 'all', 'کل': 'all', 'جدید': 'new', 'جدیدترین': 'latest',
    'قبلی': 'previous', 'فعلی': 'current', 'معتبر': 'valid', 'نامعتبر': 'invalid',
    'موجود': 'available', 'نیست': 'is not', 'است': 'is', 'شد': 'completed', 'شود': 'becomes',
    'می‌شود': 'will be', 'می‌شوند': 'will be', 'انجام': 'perform', 'اجرا': 'run',
    'فعال': 'active', 'غیرفعال': 'disabled', 'بسته': 'closed', 'باز': 'open', 'پیدا': 'found',
    'نشد': 'failed', 'شکست': 'failed', 'خورد': '', 'لغو': 'cancelled', 'تست': 'test',
    'مرحله': 'step', 'مراحل': 'steps', 'تنظیمات': 'configuration', 'دامنه': 'domain',
    'سرور': 'server', 'داده': 'data', 'دیتابیس': 'database', 'ذخیره': 'save', 'حذف': 'delete',
    'نمایش': 'show', 'اطلاعات': 'information', 'اتصال': 'connection', 'ورود': 'login',
    'خروجی': 'output', 'خطا': 'error', 'آماده': 'ready', 'آماده‌سازی': 'prepare', 'تکمیل': 'complete',
    'سرویس': 'service', 'سرویس‌ها': 'services', 'بررسی': 'check', 'تأیید': 'confirm',
    'ادامه': 'continue', 'بازگشت': 'back', 'تغییر': 'change', 'تغییرات': 'changes',
    'کامل': 'complete', 'اصلی': 'primary', 'داخلی': 'internal', 'خارجی': 'external',
    'عمومی': 'public', 'خصوصی': 'private', 'امن': 'safe', 'ایمن': 'safe', 'ناموفق': 'failed',
    'موفق': 'successful', 'موفقیت': 'success', 'اجباری': 'required', 'گزارش': 'report',
    'لازم': 'required', 'لازم است': 'is required', 'قابل': 'can be', 'پاسخ': 'response', 'واقعی': 'actual',
    'همه': 'all', 'هیچ': 'no', 'چیزی': 'item', 'مقدار': 'value', 'مقادیر': 'values', 'فایل': 'file',
    'فایل‌ها': 'files', 'مسیر': 'path', 'پوشه': 'directory', 'پوشه‌ای': 'directory',
    'دوباره': 'again', 'اول': 'first', 'آخر': 'last', 'آخرین': 'last', 'پایان': 'end',
    'پس': 'after', 'تا': 'until', 'هم': 'also', 'را': '', 'می‌کند': 'does', 'می‌کنند': 'do',
    'می‌ماند': 'remains', 'باقی': 'remaining', 'کرد': 'did', 'کنید': 'do', 'بزنید': 'press',
    'وارد': 'enter', 'انتخاب': 'selection', 'شناسه': 'identifier', 'کاربر': 'user', 'کاربری': 'user',
    'حساب': 'account', 'قفل': 'lock', 'تلاش': 'attempt', 'تلاش‌های': 'attempts', 'نام': 'name',
    'عدد': 'number', 'عددی': 'numeric', 'روز': 'days', 'ثانیه': 'seconds', 'دقیقه': 'minutes',
    'قدیمی': 'old', 'قدیمی‌تر': 'older', 'موقت': 'temporary', 'مربوط': 'related', 'پیشنهادی': 'recommended',
    'صحیح': 'correct', 'ناقص': 'incomplete', 'مستقل': 'independent', 'خودکار': 'automatic',
    'تقریبی': 'approximate', 'حفظ': 'preserved', 'نگه': 'keep', 'دسترسی': 'access',
    'وضعیت': 'status', 'عملیات': 'operation', 'برنامه': 'application', 'پروژه': 'project',
    'منو': 'menu', 'محلی': 'local', 'رسمی': 'official', 'موردنیاز': 'required',
    'ها': 's', 'های': 's', 'هایی': 's', 'تر': 'more', 'ترین': 'most',
}
FA = GoogleTranslator(source='fa', target='en')
CACHE = {}

def candidates():
    items = sorted(ROOT.rglob('*.sh'))
    for name in ('spark', 'spark-airgap', 'spark-migrate'):
        p = ROOT / name
        if p.is_file(): items.append(p)
    return sorted(set(items))

def translate_atom(word):
    if word in MANUAL:
        return MANUAL[word]
    if word in CACHE:
        return CACHE[word]
    translated = None
    for attempt in range(3):
        try:
            translated = FA.translate(word)
            if translated and not ARABIC.search(translated):
                CACHE[word] = translated
                return translated
        except Exception:
            translated = None
        time.sleep(0.6 * (attempt + 1))
    raise RuntimeError(f'Unable to translate Persian word {word!r}')

def segment_translation(core):
    core = core.strip().translate(DIGIT_TRANS)
    if not ARABIC.search(core):
        return core.translate(PUNCT_TRANS)
    punctuation = ''
    while core and core[-1] in '،؛؟':
        punctuation = core[-1].translate(PUNCT_TRANS) + punctuation
        core = core[:-1].rstrip()
    if not core:
        return punctuation
    if core in CACHE:
        return CACHE[core] + punctuation
    if core in MANUAL:
        return MANUAL[core] + punctuation
    translated = None
    for attempt in range(2):
        try:
            translated = FA.translate(core)
            if translated and not ARABIC.search(translated):
                CACHE[core] = translated
                return translated.translate(PUNCT_TRANS) + punctuation
        except Exception:
            translated = None
        time.sleep(0.6 * (attempt + 1))
    words = core.split()
    if words:
        translated = ' '.join(part for part in (translate_atom(word) for word in words) if part).strip()
        if translated and not ARABIC.search(translated):
            CACHE[core] = translated
            return translated + punctuation
    raise RuntimeError(f'Unable to translate Persian segment {core!r}')

def translate_line(line):
    if not ARABIC.search(line):
        return line
    line = line.translate(DIGIT_TRANS)
    def repl(match):
        segment = match.group(0)
        if not ARABIC.search(segment):
            return segment
        leading = segment[:len(segment) - len(segment.lstrip())]
        trailing = segment[len(segment.rstrip()):]
        return leading + segment_translation(segment.strip()) + trailing
    result = ARABIC_SEGMENT.sub(repl, line).translate(PUNCT_TRANS)
    if ARABIC.search(result):
        raise RuntimeError(f'Arabic-script text remained in shell line: {result!r}')
    return result

def main():
    changed = []
    for path in candidates():
        original = path.read_text(encoding='utf-8')
        output = []
        for line in original.splitlines(keepends=True):
            ending = '\n' if line.endswith('\n') else ''
            body = line[:-1] if ending else line
            output.append(translate_line(body) + ending)
        updated = ''.join(output)
        if updated != original:
            path.write_text(updated, encoding='utf-8')
            changed.append(str(path))
    print(f'TRANSLATED_FILES={len(changed)}')
    for path in changed:
        print(path)

if __name__ == '__main__':
    main()
