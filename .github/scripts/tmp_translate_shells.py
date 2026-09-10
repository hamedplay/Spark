#!/usr/bin/env python3
from pathlib import Path
import re
import time
from deep_translator import GoogleTranslator

ROOT = Path('deploy/spark-cli')
ARABIC = re.compile(r'[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff]')
ARABIC_SEGMENT = re.compile(r'[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff\u200c\s،؛؟]+')
QUOTED = re.compile(r'(["\'])(.*?)(?<!\\)\1')
TOKEN_RE = re.compile(
    r'\$\{[^}]+\}|\$[A-Za-z_][A-Za-z0-9_]*|\\[nrt\\]|'
    r'https?://[^\s"\']+|'
    r'(?<![A-Za-z0-9_])/(?:[A-Za-z0-9_.-]+/)*[A-Za-z0-9_.-]+|'
    r'(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?|'
    r'\b[A-Z][A-Z0-9_]{2,}\b'
)
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
    'خروجی': 'output', 'خطا': 'error', 'آماده': 'ready', 'آماده‌سازی': 'prepare',
    'سرویس': 'service', 'سرویس‌ها': 'services', 'بررسی': 'check', 'تأیید': 'confirm',
    'ادامه': 'continue', 'بازگشت': 'back', 'تغییر': 'change', 'تغییرات': 'changes',
    'کامل': 'complete', 'اصلی': 'primary', 'داخلی': 'internal', 'خارجی': 'external',
    'عمومی': 'public', 'خصوصی': 'private', 'امن': 'safe', 'ایمن': 'safe', 'ناموفق': 'failed',
    'موفق': 'successful', 'موفقیت': 'success', 'اجباری': 'required', 'گزارش': 'report',
    'گزارش نشده است': 'was not reported', 'لازم است': 'is required', 'قابل': 'can be',
    'قابل نیست': 'cannot be', 'پاسخ': 'response', 'واقعی': 'actual', 'همه': 'all',
    'هیچ': 'no', 'چیزی': 'item', 'مقدار': 'value', 'مقادیر': 'values', 'فایل': 'file',
    'فایل‌ها': 'files', 'مسیر': 'path', 'پوشه': 'directory', 'پوشه‌ای': 'directory',
    'دوباره': 'again', 'اول': 'first', 'آخر': 'last', 'آخرین': 'last', 'پایان': 'end',
    'پس': 'after', 'تا': 'until', 'هم': 'also', 'را': '', 'می‌کند': 'does', 'می‌کنند': 'do',
    'می‌ماند': 'remains', 'باقی': 'remaining', 'باقی می‌ماند': 'remains', 'باقی می‌مانند': 'remain',
    'کرد': 'did', 'کنید': 'do', 'بزنید': 'press', 'وارد': 'enter', 'انتخاب': 'selection',
    'شناسه': 'identifier', 'کاربر': 'user', 'کاربری': 'user', 'حساب': 'account',
    'قفل': 'lock', 'تلاش': 'attempt', 'تلاش‌های': 'attempts', 'نام': 'name', 'عدد': 'number',
    'عددی': 'numeric', 'روز': 'days', 'ثانیه': 'seconds', 'دقیقه': 'minutes', 'قدیمی': 'old',
    'قدیمی‌تر': 'older', 'موقت': 'temporary', 'مربوط': 'related', 'پیشنهادی': 'recommended',
    'صحیح': 'correct', 'ناقص': 'incomplete', 'مستقل': 'independent', 'خودکار': 'automatic',
    'تقریبی': 'approximate', 'حفظ': 'preserved', 'نگه': 'keep', 'دسترسی': 'access',
    'وضعیت': 'status', 'عملیات': 'operation', 'برنامه': 'application', 'پروژه': 'project',
    'منو': 'menu', 'محلی': 'local', 'رسمی': 'official', 'موردنیاز': 'required',
}
AUTO = GoogleTranslator(source='auto', target='en')
FA = GoogleTranslator(source='fa', target='en')
CACHE = {}

def candidates():
    items = sorted(ROOT.rglob('*.sh'))
    for name in ('spark', 'spark-airgap', 'spark-migrate'):
        p = ROOT / name
        if p.is_file(): items.append(p)
    return sorted(set(items))

def protect(text):
    tokens=[]
    def repl(match):
        marker=f'ZXQ{len(tokens)}QXZ'; tokens.append(match.group(0)); return marker
    return TOKEN_RE.sub(repl,text),tokens

def restore(text,tokens):
    for i,token in enumerate(tokens): text=text.replace(f'ZXQ{i}QXZ',token)
    return re.sub(r' {2,}',' ',text).strip()

def segment_translation(core):
    core = core.strip()
    if core in MANUAL: return MANUAL[core]
    translated=None
    for attempt in range(3):
        try:
            translated=FA.translate(core)
            if translated and not ARABIC.search(translated): return translated
        except Exception:
            translated=None
        time.sleep(0.8*(attempt+1))
    words=core.split()
    if words and all(word in MANUAL for word in words):
        return ' '.join(MANUAL[word] for word in words if MANUAL[word]).strip()
    raise RuntimeError(f'Unable to translate Persian segment {core!r}')

def translate_segments(text):
    def repl(match):
        segment=match.group(0)
        if not ARABIC.search(segment): return segment
        leading=segment[:len(segment)-len(segment.lstrip())]
        trailing=segment[len(segment.rstrip()):]
        return leading+segment_translation(segment.strip())+trailing
    return ARABIC_SEGMENT.sub(repl,text)

def translate_text(text):
    if not ARABIC.search(text): return text
    if text in CACHE: return CACHE[text]
    protected,tokens=protect(text)
    translated=None
    for attempt in range(2):
        try:
            translated=AUTO.translate(protected)
            if translated: break
        except Exception:
            translated=None
        time.sleep(0.8*(attempt+1))
    if translated is None: translated=protected
    translated=restore(translated,tokens)
    if ARABIC.search(translated): translated=translate_segments(translated)
    if ARABIC.search(translated):
        raise RuntimeError(f'Arabic-script text remained: {text!r} -> {translated!r}')
    CACHE[text]=translated
    return translated

def translate_line(line):
    if not ARABIC.search(line): return line
    matches=list(QUOTED.finditer(line))
    if matches:
        out=[]; pos=0
        for match in matches:
            out.append(line[pos:match.start()])
            quote=match.group(1); body=match.group(2)
            if ARABIC.search(body):
                body=translate_text(body)
                if quote=='"': body=body.replace('"','\\"')
                else: body=body.replace("'",'’')
            out.append(quote+body+quote); pos=match.end()
        out.append(line[pos:])
        result=''.join(out)
        if ARABIC.search(result):
            hash_pos=result.find('#')
            if hash_pos>=0 and ARABIC.search(result[hash_pos+1:]):
                result=result[:hash_pos+1]+' '+translate_text(result[hash_pos+1:].strip())
        if ARABIC.search(result): raise RuntimeError(f'Untranslated shell line: {result!r}')
        return result
    hash_pos=line.find('#')
    if hash_pos>=0:
        result=line[:hash_pos+1]+' '+translate_text(line[hash_pos+1:].strip())
        if ARABIC.search(result): raise RuntimeError(f'Untranslated comment: {result!r}')
        return result
    raise RuntimeError(f'Arabic-script text is outside a quoted string/comment: {line!r}')

def main():
    changed=[]
    for path in candidates():
        original=path.read_text(encoding='utf-8')
        output=[]
        for line in original.splitlines(keepends=True):
            ending='\n' if line.endswith('\n') else ''
            body=line[:-1] if ending else line
            output.append(translate_line(body)+ending)
        updated=''.join(output)
        if updated!=original:
            path.write_text(updated,encoding='utf-8')
            changed.append(str(path))
    print(f'TRANSLATED_FILES={len(changed)}')
    for path in changed: print(path)

if __name__ == '__main__':
    main()
