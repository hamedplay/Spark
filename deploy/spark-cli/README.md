# Spark Server Manager

Spark Server Manager ابزار مدیریت Production سامانه Spark روی Ubuntu 24.04 است.
نسخه `2.x` رابط قدیمی مبتنی بر `terminal-menus.sh` را به طور کامل کنار گذاشته و
از یک **single-screen curses dashboard** استفاده می‌کند؛ منو، وضعیت سرور، جزئیات
Action و خروجی/Prompt عملیات همگی در همان صفحه باقی می‌مانند.

## نصب

```bash
curl -fsSL https://raw.githubusercontent.com/hamedplay/Spark/main/deploy/spark-cli/bootstrap.sh | sudo bash
```

سپس:

```bash
spark
```

## معماری رابط v2

- `deploy/spark-cli/spark` — Bash backend/launcher و نقطه اتصال به moduleهای عملیاتی موجود.
- `deploy/spark-cli/spark-ui.py` — رابط Python stdlib `curses`.
- `deploy/spark-cli/lib/*.sh` — منطق عملیاتی نصب، Update، Backup، تست، Security و Serviceها.

UI یک renderer پایدار و تمام‌صفحه دارد و با `noutrefresh()` / `doupdate()` فقط
تغییرات لازم را به ترمینال می‌فرستد. بنابراین دیگر چرخه‌ی clear/rebuild مربوط به
TUI قبلی وجود ندارد.

هنگام اجرای Action، backend داخل یک PTY فرزند اجرا می‌شود. خروجی در پنل پایین
نمایش داده می‌شود و ورودی صفحه‌کلید به همان PTY ارسال می‌شود؛ در نتیجه promptهای
موجود مثل `MIGRATE`، `OPEN`، `RESTART` و ورودی‌های مراحل نصب بدون خروج از داشبورد
کار می‌کنند.

`terminal-menus.sh` و wrapper قدیمی `spark-tui.sh` دیگر runtime dependency نیستند.

## چیدمان

صفحه اصلی همزمان شامل این بخش‌ها است:

- Header: نسخه Manager، host، commit فعال و خلاصه وضعیت.
- Sections: دسته‌بندی عملیات.
- Actions: Actionهای دسته انتخاب‌شده.
- Details / Live Status: شرح Action و وضعیت Nginx/Coturn/Docker/Admin/Install/Backup.
- Output: خروجی و prompt زنده Task یا محتوای log انتخاب‌شده.
- Footer: کلیدهای navigation و کنترل Task.

## کنترل‌ها

در حالت عادی:

- `Tab` یا `Left/Right`: تغییر پنل فعال.
- `Up/Down` یا `j/k`: حرکت در لیست.
- `Enter`: اجرای Action انتخاب‌شده.
- `/`: فیلتر fuzzy روی Actionهای دسته جاری.
- `L`: مرور logهای Spark Manager داخل همان صفحه.
- `R`: refresh فوری وضعیت.
- `PgUp/PgDn`: scroll پنل Output.
- `?`: Help.
- `Q`: خروج.

هنگام اجرای Task:

- متن تایپ‌شده و `Enter` مستقیماً به PTY Task ارسال می‌شود.
- `PgUp/PgDn`: scroll خروجی.
- `Ctrl-C`: ارسال SIGINT به Task در حال اجرا.

## عملیات موجود

Dashboard همه قابلیت‌های Manager قبلی را بدون منوهای nested در دسترس قرار می‌دهد:

- نصب مرحله‌ای 1 تا 20 و Run All.
- Full validation و تست‌های Frontend/API/Docker/Nginx/Scheduler/TURN/Exposure/DNS/SSL.
- Docker service log selector.
- Update کنترل‌شده Spark.
- Linux package update.
- Resource monitor.
- Node/npm maintenance و audit بدون lint.
- باز/بسته کردن Supabase admin TLS/8443 محدود به `ADMIN_CIDR`.
- Service management.
- Backup management.
- Certificate management.
- Version/Security information.
- Self-update Manager.

## Logging

logهای عملیاتی در:

```text
/var/log/spark-manager/
```

ذخیره می‌شوند. کلید `L` امکان مرور logهای اخیر را در پنل Output می‌دهد.
Crashهای خود renderer در فایل زیر ثبت می‌شوند:

```text
/var/log/spark-manager/ui-crash.log
```

## Update برنامه

منطق Update Production نسبت به نسخه قبلی تغییر نکرده است:

1. `origin/main` fetch و fast-forward بودن بررسی می‌شود.
2. build و validation ابتدا در worktree موقت انجام می‌شود.
3. migrationهای قبلی حق modify/delete/rename ندارند؛ فقط migration جدید پذیرفته می‌شود.
4. قبل از deploy backup گرفته می‌شود.
5. migration جدید dry-run و سپس با تأیید `MIGRATE` اعمال می‌شود.
6. Frontend و Edge Functions خارج از مسیر live آماده و سپس controlled swap می‌شوند.
7. در failure runtime rollback می‌شود؛ migration دیتابیس خودکار rollback نمی‌شود.

## ایمنی

- Manager نیاز به root دارد و در صورت نیاز با `sudo` دوباره اجرا می‌شود.
- migration قبلی ویرایش نمی‌شود.
- Update روی repository dirty متوقف می‌شود.
- `npm audit fix` واقعی اجرا نمی‌شود؛ فقط `--dry-run` وجود دارد.
- Kong/DB/Supavisor برای Admin عمومی نمی‌شوند؛ دسترسی Admin از TLS/8443 محدود به `ADMIN_CIDR` استفاده می‌کند.
- Bootstrap ابتدا Bash/Python syntax و UI self-test را اجرا می‌کند و نصب را atomically جایگزین می‌کند؛ در smoke-test ناموفق نسخه قبلی restore می‌شود.
- از lint در workflow Manager استفاده نمی‌شود.
