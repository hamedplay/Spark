# Spark Server Manager

ابزار تعاملی مدیریت **Single Host Production** اسپارک است و منطق نصب آن از
`deploy/manual-production/single-host.md` پیروی می‌کند.

این ابزار جای مستند Manual را نمی‌گیرد؛ هدفش اجرای کنترل‌شده، ثبت log، تست هر
مرحله و جلوگیری از باقی‌ماندن تغییر نیمه‌کاره است.

## نصب Command `spark`

روی Ubuntu 24.04:

```bash
curl -fsSL https://raw.githubusercontent.com/hamedplay/Spark/main/deploy/spark-cli/bootstrap.sh | sudo bash
```

بعد از نصب:

```bash
spark
```

## منوی اصلی

- `1` نصب مرحله‌ای — مراحل 1 تا 20 مستند Single Host
- `2` Health Check، تست جزءبه‌جزء و نمایش log
- `3` Update از GitHub، migration جدید، Edge Functions، Frontend و Avatar Worker
- `4` Linux package update
- `5` Node/npm و `npm audit`
- `6` بازکردن دسترسی مدیریتی Supabase روی TLS/8443 فقط برای `ADMIN_CIDR`
- `7` بستن دسترسی مدیریتی Supabase
- `8` CPU/RAM/Disk/Docker/Network resource status
- `9` Backup DB و config
- `10` مدیریت serviceها
- `11` Certificate management
- `12` Version/Security information
- `13` Update خود Spark Server Manager

## رفتار نصب

هر مرحله:

1. prerequisiteهای خودش را بررسی می‌کند.
2. در صورت نیاز مقدار لازم را از کاربر می‌گیرد.
3. عملیات همان بخش را انجام می‌دهد.
4. validation مخصوص همان بخش را اجرا می‌کند.
5. در موفقیت `[✓]` ثبت می‌کند.
6. در failure، آخرین log را نمایش می‌دهد و مرحله را successful علامت نمی‌زند.

وضعیت مراحل در `/var/lib/spark-manager/steps/` و logها در
`/var/log/spark-manager/` نگه‌داری می‌شوند. این فایل‌ها حاوی secret چاپ‌شده
نیستند.

تنظیمات عمومی در `/etc/spark/manager.conf` با mode `600` ذخیره می‌شوند.
Secretها در فایل‌های runtime موجود در `/opt/spark-supabase/.env` و
`/etc/spark/*.env` نگه‌داری می‌شوند.

## Update برنامه

Update مستقیم روی Production source شروع نمی‌شود. ابزار:

1. `origin/main` را fetch می‌کند و fast-forward بودن را بررسی می‌کند.
2. روی Git worktree موقت `npm ci` و production build را اجرا می‌کند.
3. Avatar Worker را قبل از deploy build-validation می‌کند.
4. تغییر migrationها را بررسی می‌کند.
5. اگر migration موجود modify/delete/rename شده باشد Update را متوقف می‌کند.
6. قبل از deploy از PostgreSQL و config/runtime backup می‌گیرد.
7. migration جدید را ابتدا dry-run می‌کند و برای apply تأیید صریح می‌گیرد.
8. Frontend و Edge Functions جدید را خارج از مسیر live آماده می‌کند.
9. runtime directoryها را به‌صورت controlled swap جایگزین می‌کند.
10. Functions/Worker را recreate، Nginx را validate/reload و Health Check نهایی را اجرا می‌کند.
11. در failure بعد از runtime switch، Frontend/Functions/Git را rollback می‌کند.
12. migration دیتابیس را خودکار rollback نمی‌کند؛ backup برای recovery نگه داشته می‌شود.
13. worktree، staging directory و validation image موقت را پاک می‌کند.

Supabase upstream version به صورت خودکار روی `master` یا آخرین نسخه شناور
upgrade نمی‌شود. Pin موجود حفظ می‌شود و upgrade خود Supabase همچنان باید به
عنوان migration زیرساختی مستقل، با review release notes و backup انجام شود.

## دسترسی مدیریتی Supabase

گزینه `6` عمداً Docker/Kong port `8000` را روی `0.0.0.0` publish نمی‌کند.
به جای آن Nginx یک listener TLS روی `8443` ایجاد می‌کند که فقط
`ADMIN_CIDR` اجازه دسترسی دارد و به `127.0.0.1:8000` proxy می‌کند.

گزینه `7` listener و rule مربوط به آن را حذف می‌کند.

این طراحی شرط مستند Production مبنی بر public نبودن `5432/5433/6543/8000/9000`
را حفظ می‌کند.

## نکات ایمنی

- اجرای ابزار نیاز به root دارد؛ در صورت اجرای عادی از `sudo` استفاده می‌کند.
- Secret موجود با اجرای دوباره مرحله تولید Secret overwrite نمی‌شود؛ فقط مقادیر
  خالی یا default snapshot جایگزین می‌شوند.
- مرحله Firewall قبل از reset کردن UFW بررسی می‌کند IP فعلی SSH داخل
  `ADMIN_CIDR` باشد و تأیید صریح `FIREWALL` می‌خواهد.
- `npm audit fix` واقعی اجرا نمی‌شود؛ فقط `--dry-run` ارائه شده تا production
  repository بدون commit تغییر نکند.
- Update با repository dirty اجرا نمی‌شود.
- migrationهای قبلی از طریق این ابزار ویرایش نمی‌شوند.

## ساختار ابزار

`deploy/spark-cli/spark` فقط entrypoint است و منطق عملیاتی در `deploy/spark-cli/lib/` به چند module تقسیم شده است. Bootstrap و Self-Update ابتدا همه moduleها را دانلود و `bash -n` می‌کنند و سپس نسخه جدید را در `/usr/local/lib/spark-manager` جایگزین می‌کنند؛ بنابراین command نهایی همچنان فقط `spark` است.
