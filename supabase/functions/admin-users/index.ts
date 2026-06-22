import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function adminClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } }
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
    const action = url.pathname.split("/").pop(); // create | password | register

    // ── Public signup (no auth required) ─────────────────────────────────────
    // POST /admin-users/register — self-registration, auto-confirms email
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
        // Handle duplicate email gracefully
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

      // Sign in to return session immediately
      const { data: signInData, error: signInErr } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });
      if (signInErr || !signInData.session) {
        return json({ error: "حساب ساخته شد اما ورود خودکار ناموفق بود. لطفاً وارد شوید." }, 400);
      }

      return json({ success: true, session: signInData.session, user: signInData.user });
    }

    // ── Admin-only routes — require valid admin token ──────────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);
    const token = authHeader.replace("Bearer ", "");
    const caller = await getCallerProfile(token);
    if (!caller) return json({ error: "Unauthorized" }, 401);
    if (!caller.isAdmin) return json({ error: "Admin access required" }, 403);

    // POST /admin-users/create — admin creates user
    if (req.method === "POST" && action === "create") {
      const { email, password, profile } = await req.json();
      if (!email || !password) return json({ error: "ایمیل و رمز عبور الزامی است" }, 400);

      const { data: userData, error: createErr } = await supabase.auth.admin.createUser({
        email: email.trim().toLowerCase(),
        password,
        email_confirm: true,
        user_metadata: { full_name: profile?.full_name || "" },
      });
      if (createErr) {
        if (createErr.message?.includes("already been registered") || createErr.message?.includes("already exists")) {
          return json({ error: "این ایمیل قبلاً ثبت شده است" }, 400);
        }
        return json({ error: createErr.message }, 400);
      }

      const userId = userData.user.id;
      const { error: profileErr } = await supabase.from("profiles").upsert({
        user_id: userId,
        email: email.trim().toLowerCase(),
        full_name: profile?.full_name || null,
        username: profile?.username || null,
        phone: profile?.phone || null,
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

      if (profileErr) return json({ error: profileErr.message }, 400);
      return json({ success: true, user_id: userId });
    }

    // PUT /admin-users/password — change any user password
    if (req.method === "PUT" && action === "password") {
      const { user_id, password } = await req.json();
      if (!user_id || !password || password.length < 6) return json({ error: "اطلاعات ناقص است" }, 400);
      const { error } = await supabase.auth.admin.updateUserById(user_id, { password });
      if (error) return json({ error: error.message }, 400);
      return json({ success: true });
    }

    return json({ error: "Not found" }, 404);
  } catch (err: any) {
    return json({ error: err.message }, 500);
  }
});
