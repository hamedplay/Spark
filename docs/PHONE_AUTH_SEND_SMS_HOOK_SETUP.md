# راهنمای تنظیم Supabase Auth Send SMS Hook

> این مستند نحوه رفع خطای `HOOK_NOT_CONFIRMED` و تبدیل وضعیت ورود موبایلی از حالت «تأییدنشده» به «آماده برای Test Mode» را مرحله‌به‌مرحله توضیح می‌دهد.

---

## فهرست

1. [معماری سیستم](#۱-معماری-سیستم)
2. [پیش‌نیازها](#۲-پیش‌نیازها)
3. [تولید Secret](#۳-تولید-secret)
4. [تنظیم Secret در Supabase](#۴-تنظیم-secret-در-supabase)
5. [تنظیم Auth Hook در Dashboard](#۵-تنظیم-auth-hook-در-dashboard)
6. [بررسی اتصال داخلی](#۶-بررسی-اتصال-داخلی)
7. [Recreate سرویس‌ها (Self-Hosted)](#۷-recreate-سرویس‌ها-self-hosted)
8. [بررسی Secret بدون افشا](#۸-بررسی-secret-بدون-افشا)
9. [مقایسه امن دو Secret](#۹-مقایسه-امن-دو-secret)
10. [بررسی تنظیم Auth Hook](#۱۰-بررسی-تنظیم-auth-hook)
11. [بررسی Edge Function](#۱۱-بررسی-edge-function)
12. [تأیید اپراتور](#۱۲-تأیید-اپراتور)
13. [ترتیب تست کنترل‌شده](#۱۳-ترتیب-تست-کنترل‌شده)
14. [جدول عیب‌یابی](#۱۴-جدول-عیب‌یابی)
15. [نکات امنیتی](#۱۵-نکات-امنیتی)
16. [Checklist نهایی](#۱۶-checklist-نهایی)

---

## ۱. معماری سیستم

### جریان ارسال OTP

```
کاربر → Supabase Auth (GoTrue) → Auth Hook → Edge Function → SMS Provider
                                   ↑                      ↓
                              Secret امضا           Secret بررسی امضا
```

1. سرویس **Supabase Auth (GoTrue)** کد OTP را تولید می‌کند.
2. GoTrue درخواست را با **Secret Hook** طبق استاندارد Standard Webhooks امضا می‌کند.
3. GoTrue درخواست امضاشده را به Edge Function زیر می‌فرستد:

   ```
   auth-send-sms-hook
   ```

   - مسیر کد: `supabase/functions/auth-send-sms-hook/index.ts`
   - تنظیمات: `supabase/config.toml` → `verify_jwt = false`

4. Edge Function با همان **Secret مشترک** امضای درخواست را Verify می‌کند.
5. پس از تأیید Signature، پیامک با Provider انتخاب‌شده (از `sms_providers`) ارسال می‌شود.
6. Edge Function سپس پاسخ `200` به GoTrue برمی‌گرداند تا تأیید کند OTP ارسال شده است.

### نقش Config اپراتور

مقدار زیر در جدول `system_config` فقط یک **Flag تأیید اپراتور** است و **Secret واقعی نیست**:

| section   | key                                | معنی                                       |
| --------- | ---------------------------------- | ------------------------------------------ |
| `security`| `phone_login_hook_operator_confirmed` | اپراتور تأیید کرده که Hook و Secret درست تنظیم شده‌اند |

> **هشدار**: این Flag نباید جایگزین تنظیم واقعی Hook باشد. فقط **بعد از بررسی عملی** باید `true` شود.
>
> RPC `set_phone_login_config` این Flag را به‌عنوان Gate 3c بررسی می‌کند. اگر `false` باشد، خطای `HOOK_NOT_CONFIRMED` برگردانده می‌شود.

### وضعیت فعلی پروژه

این پروژه از **Supabase Hosted** استفاده می‌کند:

- URL: `https://icpgvfadixevdjtkllap.supabase.co`
- Custom Domain (احتمالی): `https://api.shahrmeeting.ir`
- فایل `.env` پروژه فقط شامل `VITE_SUPABASE_URL` و `VITE_SUPABASE_ANON_KEY` است.
- پوشه `worker/docker-compose.yml` فقط مربوط به سرویس `avatar-worker` است و بخش Supabase نیست.

> **نکته**: اگر از **Self-Hosted Supabase** استفاده می‌کنید، بخش [Recreate سرویس‌ها](#۷-recreate-سرویس‌ها-self-hosted) را نیز مطالعه کنید.

---

## ۲. پیش‌نیازها

قبل از تنظیم Auth Hook، موارد زیر باید آماده باشند:

| پیش‌نیاز                          | وضعیت مورد نیاز | نحوه بررسی                          |
| --------------------------------- | ---------------- | ----------------------------------- |
| Provider پیامک فعال               | `is_active=true` | `SELECT * FROM sms_providers WHERE is_active = true;` |
| Provider ورود موبایلی انتخاب‌شده | مقدار در DB      | `SELECT value FROM system_config WHERE section='sms' AND key='phone_login_sms_provider_id';` |
| TTL OTP تأییدشده                  | `true`           | `SELECT value FROM system_config WHERE section='security' AND key='phone_login_otp_ttl_operator_confirmed';` |
| Edge Function Deploy‌شده          | موجود            | Dashboard > Edge Functions           |
| دسترسی ادمین به Supabase Dashboard | فعال             | —                                   |

### بررسی وضعیت فعلی

```sql
SELECT
  (SELECT value FROM system_config WHERE section='sms' AND key='phone_login_sms_provider_id') AS provider_id,
  (SELECT value FROM system_config WHERE section='security' AND key='phone_login_enabled') AS phone_login_enabled,
  (SELECT value FROM system_config WHERE section='security' AND key='phone_login_hook_operator_confirmed') AS hook_confirmed,
  (SELECT value FROM system_config WHERE section='security' AND key='phone_login_otp_ttl_operator_confirmed') AS ttl_confirmed,
  (SELECT value FROM system_config WHERE section='security' AND key='phone_login_test_mode') AS test_mode,
  (SELECT value FROM system_config WHERE section='security' AND key='phone_login_e2e_verified') AS e2e_verified;
```

وضعیت مورد انتظار قبل از شروع:

```
provider_id          = <یک UUID معتبر>
phone_login_enabled   = false
hook_confirmed       = false
ttl_confirmed        = true
test_mode            = false
e2e_verified         = false
```

---

## ۳. تولید Secret

### دستور تولید

```bash
openssl rand -base64 32
```

### قالب Secret

کد Edge Function در `supabase/functions/auth-send-sms-hook/index.ts` (خط ۵۶) Secret را به این شکل Parse می‌کند:

```ts
const base64Secret = secret.replace(/^v1,whsec_/, "");
```

این یعنی Secret باید با پیشوند **Standard Webhooks** یعنی `v1,whsec_` شروع شود و بعد از آن مقدار Base64 قرار گیرد.

**قالب نهایی مورد انتظار:**

```
v1,whsec_<base64-encoded-secret>
```

**نمونه ساختگی (هرگز استفاده نکنید):**

```
v1,whsec_EXAMPLE_ONLY_DO_NOT_USE
```

> **هشدار**: هیچ Secret واقعی پروژه یا سرور را در مستندات، Git، Screenshot یا Chat قرار ندهید.

---

## ۴. تنظیم Secret در Supabase

### روش Hosted Supabase (Dashboard)

1. وارد **Supabase Dashboard** شوید.
2. به **Project Settings > Edge Functions** بروید.
3. در بخش **Secrets**، کلید زیر را اضافه کنید:

   | Key                   | Value                          |
   | --------------------- | ------------------------------ |
   | `SEND_SMS_HOOK_SECRET`| `v1,whsec_<your-generated-secret>` |

4. روی **Save** کلیک کنید.

> **نکته**: Edge Function این Secret را از `Deno.env.get("SEND_SMS_HOOK_SECRET")` می‌خواند (خط ۵۰ کد).

### روش Self-Hosted (docker-compose)

اگر از Self-Hosted Supabase استفاده می‌کنید، متغیر زیر را در فایل `.env` سرویس Edge Functions اضافه کنید:

```env
SEND_SMS_HOOK_SECRET=v1,whsec_<your-generated-secret>
```

سپس در `docker-compose.yml` سرویس Edge Functions، این متغیر را پاس دهید:

```yaml
# سرویس edge-functions (نام واقعی سرویس را از docker-compose خود بررسی کنید)
environment:
  SEND_SMS_HOOK_SECRET: "${SEND_SMS_HOOK_SECRET}"
```

> **هشدار**: نام واقعی سرویس Edge Functions در `docker-compose.yml` خود را با `docker compose config --services` بررسی کنید. این پروژه فقط شامل `worker/docker-compose.yml` برای `avatar-worker` است و Supabase Self-Hosted در این Repository تعریف نشده است.

---

## ۵. تنظیم Auth Hook در Dashboard

### روش Hosted Supabase (Dashboard)

1. وارد **Supabase Dashboard** شوید.
2. به **Authentication > Hooks** بروید.
3. بخش **Send SMS Hook** را پیدا کنید.
4. تنظیمات زیر را وارد کنید:

   | فیلد         | مقدار                                                              |
   | ------------ | ------------------------------------------------------------------ |
   | Hook Enabled | `true`                                                             |
   | Hook URI     | `https://icpgvfadixevdjtkllap.supabase.co/functions/v1/auth-send-sms-hook` |
   | Hook Secret  | `v1,whsec_<your-generated-secret>` (همان Secret مرحله ۳)          |

   > اگر Custom Domain تنظیم شده است:
   >
   > ```
   > https://api.shahrmeeting.ir/functions/v1/auth-send-sms-hook
   > ```

5. روی **Save** کلیک کنید.

### روش Self-Hosted (GoTrue Environment Variables)

اگر از Self-Hosted Supabase استفاده می‌کنید، متغیرهای زیر را در `.env` سرویس Auth اضافه کنید:

```env
GOTRUE_HOOK_SEND_SMS_ENABLED=true
GOTRUE_HOOK_SEND_SMS_URI=http://kong:8000/functions/v1/auth-send-sms-hook
GOTRUE_HOOK_SEND_SMS_SECRETS=v1,whsec_<your-generated-secret>
```

سپس در `docker-compose.yml` سرویس Auth:

```yaml
# سرویس auth (نام واقعی سرویس را از docker-compose خود بررسی کنید)
environment:
  GOTRUE_HOOK_SEND_SMS_ENABLED: "${GOTRUE_HOOK_SEND_SMS_ENABLED}"
  GOTRUE_HOOK_SEND_SMS_URI: "${GOTRUE_HOOK_SEND_SMS_URI}"
  GOTRUE_HOOK_SEND_SMS_SECRETS: "${GOTRUE_HOOK_SEND_SMS_SECRETS}"
```

> **هشدار**: این متغیرها فقط برای Self-Hosted Supabase هستند. در Hosted Supabase این تنظیمات از Dashboard انجام می‌شود.

---

## ۶. بررسی اتصال داخلی

### تست از داخل Container Auth (Self-Hosted)

```bash
# نام واقعی سرویس Auth را جایگزین کنید
docker compose exec <AUTH_SERVICE> sh -lc \
  'getent hosts kong && wget -S -O- http://kong:8000/functions/v1/auth-send-sms-hook'
```

> **هشدار**: این دستور Secret را چاپ نمی‌کند.

**تفسیر پاسخ‌ها:**

| پاسخ                     | معنی                                    |
| ------------------------ | --------------------------------------- |
| `401 Invalid signature`  | Function قابل دسترسی است و Secret را بررسی می‌کند — **نشانه خوب** |
| `500 Hook secret not configured` | Secret در Function تنظیم نشده — **مشکل** |
| `Connection refused`     | URI یا Network اشتباه است — **مشکل**    |
| `404 Not Found`          | مسیر اشتباه یا Function Deploy نشده     |

### تست از بیرون (Hosted Supabase)

```bash
curl -s -o /dev/null -w "%{http_code}" \
  https://icpgvfadixevdjtkllap.supabase.co/functions/v1/auth-send-sms-hook
```

کد `401` نشانه قابل‌دسترس‌بودن Function است.

---

## ۷. Recreate سرویس‌ها (Self-Hosted)

> **هشدار**: این بخش فقط برای **Self-Hosted Supabase** است. در Hosted Supabase این مرحله نیاز نیست.

تغییر Environment Variable فقط با ویرایش `.env` اعمال نمی‌شود. Containerهای مرتبط باید Recreate شوند.

```bash
# نام‌های واقعی سرویس‌ها را از docker-compose.yml خود بررسی کنید
docker compose up -d --force-recreate <AUTH_SERVICE> <FUNCTIONS_SERVICE>
```

### بررسی وضعیت

```bash
docker compose ps
docker compose logs --tail=100 <AUTH_SERVICE>
docker compose logs --tail=100 <FUNCTIONS_SERVICE>
```

---

## ۸. بررسی Secret بدون افشا

### بررسی وجود Secret در سرویس Auth (Self-Hosted)

```bash
docker compose exec <AUTH_SERVICE> sh -lc '
test "$GOTRUE_HOOK_SEND_SMS_ENABLED" = "true" &&
echo "HOOK ENABLED" ||
echo "HOOK DISABLED"

test -n "$GOTRUE_HOOK_SEND_SMS_URI" &&
echo "HOOK URI PRESENT" ||
echo "HOOK URI MISSING"

test -n "$GOTRUE_HOOK_SEND_SMS_SECRETS" &&
echo "AUTH HOOK SECRET PRESENT" ||
echo "AUTH HOOK SECRET MISSING"
'
```

### بررسی وجود Secret در Edge Function Runtime (Self-Hosted)

```bash
docker compose exec <FUNCTIONS_SERVICE> sh -lc '
test -n "$SEND_SMS_HOOK_SECRET" &&
echo "FUNCTION SECRET PRESENT" ||
echo "FUNCTION SECRET MISSING"
'
```

### بررسی در Hosted Supabase

در Dashboard > Edge Functions > Secrets، وجود کلید `SEND_SMS_HOOK_SECRET` را بررسی کنید. مقدار نمایش داده نمی‌شود اما وجود کلید قابل تأیید است.

---

## ۹. مقایسه امن دو Secret

> **هشدار**: فقط Hashها مقایسه شوند. Secret اصلی هرگز نمایش داده نشود.

### روش Self-Hosted

```bash
# Hash سمت Auth
docker compose exec <AUTH_SERVICE> sh -lc \
  'printf %s "$GOTRUE_HOOK_SEND_SMS_SECRETS" | sha256sum'

# Hash سمت Functions
docker compose exec <FUNCTIONS_SERVICE> sh -lc \
  'printf %s "$SEND_SMS_HOOK_SECRET" | sha256sum'
```

اگر دو Hash یکسان باشند، Secretها مطابقت دارند.

### روش Hosted Supabase

در Hosted Supabase، Secret از Dashboard تنظیم می‌شود و هم برای Auth Hook و هم برای Edge Function از همان منبع استفاده می‌شود. مطابقت به‌صورت خودکار تضمین می‌شود، به شرطی که در هر دو جایگاه (Auth Hook و Edge Function Secret) **یک مقدار یکسان** وارد شده باشد.

---

## ۱۰. بررسی تنظیم Auth Hook

### موارد لازم برای تأیید

| مورد                        | نحوه بررسی                                    |
| --------------------------- | --------------------------------------------- |
| Hook enabled                | Dashboard > Authentication > Hooks            |
| Hook URI present            | Dashboard > Authentication > Hooks            |
| Hook secret present         | Dashboard > Authentication > Hooks            |
| Auth container recreated    | `docker compose ps` (Self-Hosted)             |
| No startup config error     | `docker compose logs <AUTH_SERVICE>` (Self-Hosted) |

### Logهای احتمالی مرتبط

| پیام Log                    | معنی                                       |
| --------------------------- | ------------------------------------------ |
| `invalid hook URI`          | URI اشتباه یا ناقص است                      |
| `missing hook secret`       | Secret به Auth پاس داده نشده               |
| `connection refused`        | Function از Auth قابل دسترسی نیست           |
| `invalid webhook signature` | Secretهای Auth و Function متفاوت‌اند        |
| `hook timeout`              | Function در زمان مقرر پاسخ نداده            |

---

## ۱۱. بررسی Edge Function

کد واقعی Function در `supabase/functions/auth-send-sms-hook/index.ts` این پاسخ‌ها را برمی‌گرداند:

| کد HTTP | پیام                      | معنی                                                                 |
| ------- | ------------------------- | -------------------------------------------------------------------- |
| `500`   | `Hook secret not configured` | متغیر `SEND_SMS_HOOK_SECRET` در Edge Function تنظیم نشده است         |
| `401`   | `Invalid signature`        | امضای درخواست معتبر نیست — Secretها متفاوت‌اند یا درخواست دستی است   |
| `400`   | `Missing webhook-id`      | هدر `webhook-id` وجود ندارد                                          |
| `400`   | `Invalid hook payload`     | بدنه درخواست ساختار صحیح ندارد (`user` یا `sms` وجود ندارد)          |
| `403`   | `Phone login is disabled`  | `phone_login_enabled` در `system_config` برابر `false` است          |
| `503`   | `SMS provider unavailable` | Provider انتخاب‌شده غیرفعال یا موجود نیست                           |
| `502`   | `SMS dispatch failed`      | Provider خطا برگرداند                                                |
| `504`   | `Hook deadline exceeded`   | مهلت ۴.۵ ثانیه‌ای Hook تمام شد                                       |

### تفسیر مهم

- **`401 Invalid signature`** برای یک درخواست دستی بدون امضای معتبر، پاسخ مورد انتظار و **امن** است. این نشانه قابل‌دسترس‌بودن Function است.
- **`500 Hook secret not configured`** یعنی متغیر `SEND_SMS_HOOK_SECRET` در Edge Function اعمال نشده است. باید در Dashboard (یا docker-compose) تنظیم و سرویس Recreate شود.

---

## ۱۲. تأیید اپراتور

> **فقط بعد از موفقیت تمام بررسی‌های بالا** این SQL را اجرا کنید.

### SQL تأیید (Idempotent)

```sql
INSERT INTO public.system_config (
  section,
  key,
  value,
  value_type,
  label,
  description
)
VALUES (
  'security',
  'phone_login_hook_operator_confirmed',
  'true',
  'boolean',
  'تأیید اپراتور Auth Hook',
  'اپراتور تأیید کرده است که Send SMS Auth Hook و Secret مشترک به‌درستی تنظیم شده‌اند'
)
ON CONFLICT (section, key)
DO UPDATE SET
  value = EXCLUDED.value,
  updated_at = now();
```

### SQL Rollback

```sql
UPDATE public.system_config
SET value = 'false',
    updated_at = now()
WHERE section = 'security'
  AND key = 'phone_login_hook_operator_confirmed';
```

> **هشدار**: این Config نباید Secret واقعی را نگهداری کند. Secret فقط در Environment Variable یا Dashboard Secret ذخیره شود.

### بررسی نتیجه

```sql
SELECT value FROM public.system_config
WHERE section = 'security' AND key = 'phone_login_hook_operator_confirmed';
```

مقدار باید `true` باشد.

---

## ۱۳. ترتیب تست کنترل‌شده

> **هشدار**: ورود عمومی تا پایان تست E2E باید **غیرفعال** بماند.

```
 ۱. Provider آماده و فعال
 ۲. TTL OTP تأییدشده (بین ۶۰ تا ۸۶۴۰۰ ثانیه)
 ۳. تولید Secret امن
 ۴. تنظیم Secret در Edge Function (Dashboard یا docker-compose)
 ۵. تنظیم Auth Hook در Dashboard (یا GoTrue env vars)
 ۶. بررسی اتصال داخلی (دستور تست URI)
 ۷. تأیید اپراتور: phone_login_hook_operator_confirmed = true
 ۸. ورود عمومی همچنان false
 ۹. فعال‌کردن Test Mode فقط برای شماره مجاز
۱۰. درخواست یک OTP کنترل‌شده (با شماره تست)
۱۱. بررسی رسیدن SMS
۱۲. بررسی Bale در صورت فعال‌بودن آزمایشی
۱۳. تکمیل ورود با OTP دریافت‌شده
۱۴. ثبت E2E verified: phone_login_e2e_verified = true
۱۵. غیرفعال‌کردن Test Mode
۱۶. فعال‌کردن ورود عمومی (فقط پس از E2E موفق)
```

---

## ۱۴. جدول عیب‌یابی

| وضعیت                        | علت محتمل               | بررسی                  | راه‌حل                                   |
| ---------------------------- | ----------------------- | ---------------------- | ---------------------------------------- |
| `HOOK_NOT_CONFIRMED`         | Flag اپراتور `false`    | Query `system_config`  | بعد از تنظیم واقعی Hook، Flag را `true` کن |
| `OPERATOR_NOT_CONFIRMED`     | Hook تأیید نشده         | `get_public_auth_config` | تنظیم و تأیید Hook                       |
| `Hook secret not configured` | Secret در Function نیست | env داخل Functions     | تنظیم Secret و Recreate سرویس            |
| `Invalid signature`          | Secretها متفاوت‌اند    | Hash comparison        | یکسان‌سازی Secret                        |
| `Connection refused`         | URI یا Network اشتباه   | تست از Auth container  | اصلاح URI                                |
| `PROVIDER_NOT_READY`         | Provider غیرفعال        | `sms_providers`        | فعال یا انتخاب Provider صحیح             |
| `PROVIDER_REQUIRED`          | Provider انتخاب‌نشده   | `system_config`        | انتخاب Provider با `set_phone_login_sms_provider` |
| `TTL_NOT_CONFIRMED`          | TTL تأیید نشده          | admin status           | ثبت TTL واقعی                            |
| `E2E_NOT_VERIFIED`           | تست کامل نشده           | config status          | اجرای Test Mode و E2E                    |
| `TEST_MODE_STILL_ACTIVE`     | Test Mode هنوز روشن است | config status          | غیرفعال‌کردن Test Mode قبل از ورود عمومی  |

---

## ۱۵. نکات امنیتی

- **Secret داخل Git Commit قرار نگیرد.** فایل `.env` در `.gitignore` باید باشد.
- **Secret داخل Screenshot یا Chat ارسال نشود.**
- **Secret در Log چاپ نشود.** Edge Function فقط پیام‌های بدون Secret لاگ می‌کند.
- **`SERVICE_ROLE_KEY` در Frontend استفاده نشود.** این کلید فقط در Edge Function و سمت سرور معتبر است.
- **`phone_login_hook_operator_confirmed=true` جایگزین تنظیم واقعی Hook نیست.** این فقط یک Flag تأیید است.
- **قبل از E2E، ورود عمومی فعال نشود.** ورود عمومی فقط پس از تست موفق فعال شود.
- **Request دستی OTP واقعی اجرا نشود** مگر با اجازه صریح اپراتور.
- **Secretهای موجود در فایل‌های اشتراک‌گذاری‌شده باید Rotate شوند.**
- **تغییر JWT Secret بدون برنامه‌ریزی** می‌تواند Session کاربران را باطل کند.

---

## ۱۶. Checklist نهایی

```text
[ ] Secret امن تولید شد
[ ] Secret در Edge Function (Dashboard یا .env) ثبت شد
[ ] Secret به Auth Hook (Dashboard یا GoTrue env) پاس داده شد
[ ] Hash دو Secret یکسان است
[ ] Hook URI از Auth قابل دسترسی است
[ ] Function بدون Signature پاسخ امن می‌دهد (401)
[ ] Provider فعال و آماده است
[ ] TTL OTP تأیید شده است
[ ] ورود عمومی غیرفعال است
[ ] operator_confirmed پس از بررسی true شد
[ ] Test Mode فقط برای شماره مجاز فعال شد
[ ] تست E2E موفق شد
[ ] Test Mode غیرفعال شد
[ ] ورود عمومی پس از E2E فعال شد
```

---

> **یادآوری**: این مستند فقط راهنما است. هیچ Configی در زمان ساخت این مستند تغییر نکرده است. تمام مراحل باید توسط اپراتور با دسترسی کامل اجرا شود.
