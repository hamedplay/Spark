import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function normalizeIranPhone(value?: string | null): string {
  const digits = String(value || "").replace(/\D/g, "");
  if (/^00989\d{9}$/.test(digits)) return digits.slice(2);
  if (/^989\d{9}$/.test(digits)) return digits;
  if (/^09\d{9}$/.test(digits)) return `98${digits.slice(1)}`;
  if (/^9\d{9}$/.test(digits)) return `98${digits}`;
  return "";
}

function maskPhone(phone: string): string {
  if (!phone || phone.length <= 4) return "***";
  return phone.slice(0, 3) + "****" + phone.slice(-4);
}

function adminClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

async function getCallerProfile(token: string) {
  const supabase = adminClient();
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return null;
  const { data } = await supabase.from("profiles").select("is_admin").eq("user_id", user.id).maybeSingle();
  return { user, isAdmin: data?.is_admin === true };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const supabase = adminClient();
    const url = new URL(req.url);
    const action = url.pathname.split("/").pop();

    // ── Public signup (no auth required) ─────────────────────────────────────
    if (req.method === "POST" && action === "register") {
      const { email, password, full_name } = await req.json();
      if (!email || !password) return json({ error: "ایمیل و رمز عبور الزامی است" }, 400);
      if (password.length < 6) return json({ error: "رمز عبور باید حداقل ۶ کاراکتر باشد" }, 400);

      const { data: userData, error: createErr } = await supabase.auth.admin.createUser({
        email: email.trim().toLowerCase(),
        password,
        email_confirm: true,
        user_metadata: { full_name: full_name || "" },
      });
      if (createErr) {
        if (createErr.message?.includes("already been registered") || createErr.message?.includes("already exists")) {
          return json({ error: "این ایمیل قبلاً ثبت شده است" }, 400);
        }
        return json({ error: createErr.message }, 400);
      }

      const userId = userData.user.id;
      await supabase.from("profiles").upsert({
        user_id: userId,
        email: email.trim().toLowerCase(),
        full_name: full_name?.trim() || null,
        is_active: true,
        is_admin: false,
      }, { onConflict: "user_id" });

      const { data: signInData, error: signInErr } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });
      if (signInErr || !signInData.session) {
        return json({ error: "حساب ساخته شد اما ورود خودکار ناموفق بود. لطفاً وارد شوید." }, 400);
      }

      return json({ success: true, session: signInData.session, user: signInData.user });
    }

    // ── Admin-only routes ────────────────────────────────────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);
    const token = authHeader.replace("Bearer ", "");
    const caller = await getCallerProfile(token);
    if (!caller) return json({ error: "Unauthorized" }, 401);
    if (!caller.isAdmin) return json({ error: "Admin access required" }, 403);

    // POST /admin-users/create — admin creates user with email + phone from the start
    if (req.method === "POST" && action === "create") {
      const { email, password, profile } = await req.json();
      if (!email || !password) return json({ error: "ایمیل و رمز عبور الزامی است" }, 400);
      if (password.length < 6) return json({ error: "رمز عبور باید حداقل ۶ کاراکتر باشد" }, 400);

      const trimmedEmail = email.trim().toLowerCase();

      // ── Validate and normalize phone ──────────────────────────────────────
      const rawPhone: string | undefined = profile?.phone;
      const normalizedPhone = normalizeIranPhone(rawPhone);
      const hasPhone = normalizedPhone.length > 0;

      // ── Check username uniqueness ─────────────────────────────────────────
      if (profile?.username) {
        const { data: existingUsername } = await supabase
          .from("profiles")
          .select("user_id")
          .eq("username", profile.username)
          .maybeSingle();
        if (existingUsername) {
          return json({ error: "این نام کاربری قبلاً استفاده شده است" }, 400);
        }
      }

      // ── Check email uniqueness in auth.users ───────────────────────────────
      const { data: existingAuthUsers } = await supabase.auth.admin.listUsers();
      const emailExists = existingAuthUsers?.users?.some(
        (u: { email?: string }) => u.email?.toLowerCase() === trimmedEmail,
      );
      if (emailExists) {
        return json({ error: "این ایمیل قبلاً ثبت شده است" }, 400);
      }

      // ── Check phone uniqueness in profiles ────────────────────────────────
      if (hasPhone) {
        const { data: phoneConflict } = await supabase
          .from("profiles")
          .select("user_id")
          .eq("phone", rawPhone)
          .maybeSingle();
        if (phoneConflict) {
          return json({ error: "این شماره موبایل قبلاً برای کاربر دیگری ثبت شده است" }, 400);
        }
      }

      // ── Check phone uniqueness in auth.users ───────────────────────────────
      if (hasPhone) {
        const { data: authPhoneConflict } = await supabase.auth.admin.listUsers();
        const phoneInAuth = authPhoneConflict?.users?.some(
          (u: { phone?: string }) => u.phone && normalizeIranPhone(u.phone) === normalizedPhone,
        );
        if (phoneInAuth) {
          return json({ error: "این شماره موبایل قبلاً در سیستم احراز هویت ثبت شده است" }, 400);
        }
      }

      // ── Create one Auth User with email + phone ───────────────────────────
      const createParams: Record<string, unknown> = {
        email: trimmedEmail,
        password,
        email_confirm: true,
        user_metadata: { full_name: profile?.full_name || "" },
      };

      if (hasPhone) {
        createParams.phone = `+${normalizedPhone}`;
        createParams.phone_confirm = true;
      }

      const { data: userData, error: createErr } = await supabase.auth.admin.createUser(
        createParams as Parameters<typeof supabase.auth.admin.createUser>[0],
      );

      if (createErr) {
        if (createErr.message?.includes("already been registered") || createErr.message?.includes("already exists")) {
          return json({ error: "این ایمیل قبلاً ثبت شده است" }, 400);
        }
        return json({ error: createErr.message }, 400);
      }

      const userId = userData.user.id;

      // ── Create Profile with same UUID ─────────────────────────────────────
      const { error: profileErr } = await supabase.from("profiles").upsert({
        user_id: userId,
        email: trimmedEmail,
        full_name: profile?.full_name || null,
        username: profile?.username || null,
        phone: hasPhone ? normalizedPhone : (profile?.phone || null),
        organization: profile?.organization || null,
        position: profile?.position || null,
        department: profile?.department || null,
        employee_id: profile?.employee_id || null,
        hire_date: profile?.hire_date || null,
        birth_date: profile?.birth_date || null,
        gender: profile?.gender || null,
        city: profile?.city || null,
        location: profile?.location || null,
        bio: profile?.bio || null,
        website: profile?.website || null,
        linkedin_url: profile?.linkedin_url || null,
        national_id: profile?.national_id || null,
        is_admin: profile?.is_admin === true,
        is_active: true,
      }, { onConflict: "user_id" });

      if (profileErr) {
        // Compensating delete: remove the auth user we just created
        await supabase.auth.admin.deleteUser(userId);
        try {
          await supabase.from("audit_log").insert({
            user_id: caller.user.id,
            module: "security",
            action: "user_create_compensating_delete",
            entity_name: "user",
            entity_id: userId,
            details: `Profile creation failed; auth user deleted. Email: ${trimmedEmail}`,
            severity: "error",
          });
        } catch { /* best-effort audit */ }
        return json({ error: "ساخت پروفایل ناموفق بود و حساب احراز هویت حذف شد" }, 500);
      }

      // ── Verify match ──────────────────────────────────────────────────────
      const { data: verifyProfile } = await supabase
        .from("profiles")
        .select("user_id, phone")
        .eq("user_id", userId)
        .maybeSingle();

      if (!verifyProfile) {
        // Profile didn't actually persist — delete auth user and report
        await supabase.auth.admin.deleteUser(userId);
        try {
          await supabase.from("audit_log").insert({
            user_id: caller.user.id,
            module: "security",
            action: "user_create_verify_failed",
            entity_name: "user",
            entity_id: userId,
            details: `Profile verification failed; auth user deleted. Email: ${trimmedEmail}`,
            severity: "error",
          });
        } catch { /* best-effort audit */ }
        return json({ error: "تأیید پروفایل ناموفق بود و حساب احراز هویت حذف شد" }, 500);
      }

      // ── Audit ──────────────────────────────────────────────────────────────
      try {
        await supabase.from("audit_log").insert({
          user_id: caller.user.id,
          module: "security",
          action: "user_create",
          entity_name: "user",
          entity_id: userId,
          details: `Created user. Email: ${trimmedEmail}, Phone: ${hasPhone ? maskPhone(normalizedPhone) : "none"}`,
          severity: "info",
        });
      } catch { /* best-effort audit */ }

      return json({ success: true, user_id: userId });
    }

    // PUT /admin-users/password — change any user password
    if (req.method === "PUT" && action === "password") {
      const { user_id, password } = await req.json();
      if (!user_id || !password || password.length < 6) return json({ error: "اطلاعات ناقص است" }, 400);
      const { error } = await supabase.auth.admin.updateUserById(user_id, { password });
      if (error) return json({ error: error.message }, 400);

      try {
        await supabase.from("audit_log").insert({
          user_id: caller.user.id,
          module: "security",
          action: "admin_password_change",
          entity_name: "user",
          entity_id: user_id,
          details: "Admin changed user password",
          severity: "warning",
        });
      } catch { /* best-effort audit */ }

      return json({ success: true });
    }

    return json({ error: "Not found" }, 404);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal error";
    return json({ error: message }, 500);
  }
});
