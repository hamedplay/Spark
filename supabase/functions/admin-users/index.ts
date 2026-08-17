import "jsr:@supabase/functions-js@2.111.0/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.3";
import { requireFullAuthAccess, deniedResponse } from "../_shared/requireFullAuthAccess.ts";

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

function maskEmail(email: string): string {
  if (!email || !email.includes("@")) return "***";
  const [local, domain] = email.split("@");
  return local.slice(0, 2) + "***@" + domain;
}

function adminClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
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

    if (req.method === "POST" && action === "register") {
      return json({ error: "REGISTRATION_FLOW_REPLACED" }, 410);
    }

    const authResult = await requireFullAuthAccess(req);
    if (!authResult.ok) return deniedResponse();
    const callerUserId = authResult.userId!;

    const { data: callerProfile } = await supabase
      .from("profiles").select("is_admin").eq("user_id", callerUserId).maybeSingle();
    if (!callerProfile?.is_admin) return json({ error: "Admin access required" }, 403);

    if (req.method === "POST" && action === "create") {
      const { email, password, profile } = await req.json();
      if (!email || !password) return json({ error: "ایمیل و رمز عبور الزامی است" }, 400);
      if (password.length < 6) return json({ error: "رمز عبور باید حداقل ۶ کاراکتر باشد" }, 400);

      const trimmedEmail = email.trim().toLowerCase();
      const rawPhone: string | undefined = profile?.phone;
      const normalizedPhone = normalizeIranPhone(rawPhone);
      if (!normalizedPhone) return json({ error: "شماره موبایل الزامی است" }, 400);
      if (!profile?.username) return json({ error: "نام کاربری الزامی است" }, 400);

      const { data: existingUsername } = await supabase
        .from("profiles")
        .select("user_id")
        .eq("normalized_username", profile.username.toLowerCase())
        .maybeSingle();
      if (existingUsername) return json({ error: "این نام کاربری قبلاً استفاده شده است" }, 400);

      const { data: existingEmail } = await supabase
        .from("profiles")
        .select("user_id")
        .eq("normalized_email", trimmedEmail)
        .maybeSingle();
      if (existingEmail) return json({ error: "این ایمیل قبلاً ثبت شده است" }, 400);

      const { data: existingPhone } = await supabase
        .from("profiles")
        .select("user_id")
        .eq("normalized_phone", normalizedPhone)
        .maybeSingle();
      if (existingPhone) return json({ error: "این شماره موبایل قبلاً ثبت شده است" }, 400);

      const createParams: Record<string, unknown> = {
        email: trimmedEmail,
        password,
        email_confirm: true,
        phone: `+${normalizedPhone}`,
        phone_confirm: true,
        user_metadata: {
          full_name: profile?.full_name || "",
          username: profile.username,
          email: trimmedEmail,
          phone: `+${normalizedPhone}`,
          first_name: profile?.first_name || "",
          last_name: profile?.last_name || "",
          organization: profile?.organization || "",
          position: profile?.position || "",
          department: profile?.department || "",
          employee_id: profile?.employee_id || "",
        },
        app_metadata: { registration_flow: "admin_created_v1" },
      };

      const { data: userData, error: createErr } = await supabase.auth.admin.createUser(
        createParams as Parameters<typeof supabase.auth.admin.createUser>[0],
      );

      if (createErr) {
        if (createErr.message?.includes("already been registered") || createErr.message?.includes("already exists")) {
          return json({ error: "این ایمیل قبلاً ثبت شده است" }, 400);
        }
        return json({ error: "خطا در ایجاد حساب کاربری" }, 400);
      }

      const userId = userData.user.id;
      const { data: verifyProfile } = await supabase
        .from("profiles")
        .select("user_id, account_status, registration_source")
        .eq("user_id", userId)
        .maybeSingle();

      if (!verifyProfile) return json({ error: "پروفایل به‌صورت خودکار ساخته نشد" }, 500);

      try {
        await supabase.from("audit_log").insert({
          user_id: callerUserId,
          module: "security",
          action: "user_create",
          entity_name: "user",
          entity_id: userId,
          details: `Created user. Email: ${maskEmail(trimmedEmail)}, Phone: ${maskPhone(normalizedPhone)}`,
          severity: "info",
        });
      } catch { /* best-effort audit */ }

      return json({ success: true, user_id: userId });
    }

    if (req.method === "PUT" && action === "password") {
      const { user_id, password } = await req.json();
      if (!user_id || typeof password !== "string") {
        return json({ error: "اطلاعات ناقص است" }, 400);
      }
      if (
        password.length < 8 ||
        password.length > 128 ||
        !/[a-zA-Z]/.test(password) ||
        !/\d/.test(password)
      ) {
        return json({ error: "رمز عبور باید حداقل ۸ کاراکتر و شامل حروف و عدد باشد" }, 400);
      }

      const { error } = await supabase.auth.admin.updateUserById(user_id, { password });
      if (error) return json({ error: "خطا در تغییر رمز عبور" }, 400);

      try {
        await supabase.from("audit_log").insert({
          user_id: callerUserId,
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
  } catch {
    return json({ error: "خطا در پردازش درخواست" }, 500);
  }
});
