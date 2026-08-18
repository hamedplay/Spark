import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const write = (p, value) => {
  const full = path.join(root, p);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, value);
};
const replaceOnce = (file, before, after) => {
  const value = read(file);
  const count = value.split(before).length - 1;
  if (count !== 1) throw new Error(`${file}: expected one match, got ${count}`);
  write(file, value.replace(before, after));
};

// Backup / restore: FULL session + exact config_backup permission (admin shortcut lives in DB helper).
replaceOnce(
  'supabase/functions/backup-data/index.ts',
  'import { requireFullAuthAccess, deniedResponse } from "../_shared/requireFullAuthAccess.ts";',
  'import { requireFullAuthAccess, deniedResponse, hasCurrentPermission } from "../_shared/requireFullAuthAccess.ts";',
);
replaceOnce(
  'supabase/functions/backup-data/index.ts',
  `    const client = adminClient();
    const { data: profile } = await client
      .from("profiles")
      .select("is_admin")
      .eq("user_id", auth.userId)
      .maybeSingle();
    if (profile?.is_admin !== true) return json({ error: "ADMIN_REQUIRED" }, 403);`,
  `    if (!(await hasCurrentPermission(auth, "config_backup"))) {
      return json({ error: "PERMISSION_REQUIRED" }, 403);
    }
    const client = adminClient();`,
);

replaceOnce(
  'supabase/functions/restore-backup/index.ts',
  'import { requireFullAuthAccess, deniedResponse } from "../_shared/requireFullAuthAccess.ts";',
  'import { requireFullAuthAccess, deniedResponse, hasCurrentPermission } from "../_shared/requireFullAuthAccess.ts";',
);
replaceOnce(
  'supabase/functions/restore-backup/index.ts',
  `    const client = adminClient();
    const { data: caller } = await client.from("profiles").select("is_admin").eq("user_id", auth.userId).maybeSingle();
    if (caller?.is_admin !== true) return json({ error: "ADMIN_REQUIRED" }, 403);`,
  `    if (!(await hasCurrentPermission(auth, "config_backup"))) {
      return json({ error: "PERMISSION_REQUIRED" }, 403);
    }
    const client = adminClient();`,
);

// Daily report manual send keeps cron/service paths unchanged; user path uses page permission.
replaceOnce(
  'supabase/functions/send-daily-meetings/dailyReportSupport.ts',
  'import { requireFullAuthAccess } from "../_shared/requireFullAuthAccess.ts";',
  'import { requireFullAuthAccess, hasCurrentPermission } from "../_shared/requireFullAuthAccess.ts";',
);
replaceOnce(
  'supabase/functions/send-daily-meetings/dailyReportSupport.ts',
  `  // 4. Admin JWT via centralized auth gate
  const authResult = await requireFullAuthAccess(req);
  if (!authResult.ok) return null;
  const callerUserId = authResult.userId!;

  const supabase = adminClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin, is_active")
    .eq("user_id", callerUserId)
    .maybeSingle();
  if (!profile?.is_active || !profile?.is_admin) return null;
  return "admin";`,
  `  // 4. User JWT via centralized FULL-auth gate + exact configuration permission.
  const authResult = await requireFullAuthAccess(req);
  if (!authResult.ok) return null;
  if (!(await hasCurrentPermission(authResult, "config_notifications.daily_report"))) return null;
  return "admin";`,
);

// Social messenger proxy: exact social-notifications config permission.
replaceOnce(
  'supabase/functions/messenger-proxy/index.ts',
  'import { requireFullAuthAccess, deniedResponse } from "../_shared/requireFullAuthAccess.ts";',
  'import { requireFullAuthAccess, deniedResponse, hasCurrentPermission } from "../_shared/requireFullAuthAccess.ts";',
);
replaceOnce(
  'supabase/functions/messenger-proxy/index.ts',
  `    const user = { id: authResult.userId! };

    const supabaseUrl = Deno.env.get('SUPABASE_URL');`,
  `    if (!(await hasCurrentPermission(authResult, 'config_notifications.social_notifications'))) {
      return json({ ok: false, description: 'مجوز پیکربندی شبکه‌های اجتماعی لازم است' }, 403);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');`,
);
replaceOnce(
  'supabase/functions/messenger-proxy/index.ts',
  `    const { data: profile, error: profileErr } = await admin
      .from('profiles')
      .select('is_admin')
      .eq('user_id', user.id)
      .maybeSingle();

    if (profileErr) {
      return json({
        ok: false,
        description: 'خطا در بررسی نقش: ' + profileErr.message,
      }, 500);
    }

    if (!profile || profile.is_admin !== true) {
      return json({
        ok: false,
        description: 'دسترسی فقط برای ادمین',
      }, 403);
    }

`,
  '',
);

// Phone-runtime diagnostic: security configuration permission; origin + FULL-session gates remain intact.
replaceOnce(
  'supabase/functions/check-phone-password-reset-runtime/index.ts',
  'import { requireFullAuthAccess } from "../_shared/requireFullAuthAccess.ts";',
  'import { requireFullAuthAccess, hasCurrentPermission } from "../_shared/requireFullAuthAccess.ts";',
);
replaceOnce(
  'supabase/functions/check-phone-password-reset-runtime/index.ts',
  `  try {
    const admin = adminClient();
    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("is_admin,account_status")
      .eq("user_id", authResult.userId!)
      .maybeSingle();

    if (profileError || !profile || profile.account_status !== "ACTIVE" || profile.is_admin !== true) {
      return new Response(JSON.stringify({ ok: false, error: "NOT_ADMIN" }),
        { status: 403, headers: { "Content-Type": "application/json", ...cors } });
    }

    const readiness = await computeUnifiedRecoveryReadiness(admin, allowedOrigins);`,
  `  try {
    if (!(await hasCurrentPermission(authResult, "config_access.security"))) {
      return new Response(JSON.stringify({ ok: false, error: "PERMISSION_REQUIRED" }),
        { status: 403, headers: { "Content-Type": "application/json", ...cors } });
    }
    const admin = adminClient();
    const readiness = await computeUnifiedRecoveryReadiness(admin, allowedOrigins);`,
);

// SMS test connection is a configuration operation; normal dispatch authorization is unchanged.
replaceOnce(
  'supabase/functions/send-sms/index.ts',
  'import { requireFullAuthAccess, deniedResponse } from "../_shared/requireFullAuthAccess.ts";',
  'import { requireFullAuthAccess, deniedResponse, hasCurrentPermission } from "../_shared/requireFullAuthAccess.ts";',
);
replaceOnce(
  'supabase/functions/send-sms/index.ts',
  `  // ── FULL auth access gate (only for real user callers; service-to-service calls bypass) ──
  if (caller.userId !== "service") {
    const fullAuth = await requireFullAuthAccess(req);
    if (!fullAuth.ok) return deniedResponse();
  }

  let isAuthOtp = false;`,
  `  // ── FULL auth access gate (only for real user callers; service-to-service calls bypass) ──
  let canConfigureSms = caller.isAdmin;
  if (caller.userId !== "service") {
    const fullAuth = await requireFullAuthAccess(req);
    if (!fullAuth.ok) return deniedResponse();
    if (!canConfigureSms) {
      canConfigureSms = await hasCurrentPermission(fullAuth, "config_notifications.sms");
    }
  }

  let isAuthOtp = false;`,
);
replaceOnce(
  'supabase/functions/send-sms/index.ts',
  `    // test_connection and provider management require admin
    if (mode === "test_connection" && !caller.isAdmin) {
      return json({ ok: false, error: "Forbidden: admin access required" }, 403);
    }`,
  `    // Test-connection belongs to the SMS configuration page. Other dispatch modes are unchanged.
    if (mode === "test_connection" && !canConfigureSms) {
      return json({ ok: false, error: "Forbidden: SMS configuration permission required" }, 403);
    }`,
);

// Non-admin delegates can inspect users/groups and manage only the explicitly delegated rights surfaces.
replaceOnce(
  'src/components/UserManagementPanel.tsx',
  '  const { hasPermission } = usePermissions();',
  '  const { hasPermission, isAdmin } = usePermissions();',
);
replaceOnce(
  'src/components/UserManagementPanel.tsx',
  `{p.user_id !== currentUserId && (
                        <AdminUserDeleteAction`,
  `{isAdmin && p.user_id !== currentUserId && (
                        <AdminUserDeleteAction`,
);
replaceOnce(
  'src/components/UserManagementPanel.tsx',
  `{menuItems(p).filter(item => item.panel !== 'access' || canManageAccess).map(({ icon: Icon, label, panel: target, color }) => (`,
  `{menuItems(p).filter(item => isAdmin || item.panel === 'preview' || (item.panel === 'access' && canManageAccess)).map(({ icon: Icon, label, panel: target, color }) => (`,
);
replaceOnce(
  'src/components/UserGroupsPanel.tsx',
  '  const { hasPermission } = usePermissions();',
  '  const { hasPermission, isAdmin } = usePermissions();',
);
replaceOnce(
  'src/components/UserGroupsPanel.tsx',
  `  const menuItems = (g: UserGroup) => [
    { icon: Edit2, label: 'ویرایش گروه', panel: 'edit' as Panel, color: 'text-blue-500' },
    { icon: Users, label: 'مدیریت اعضا', panel: 'members' as Panel, color: 'text-teal-500' },
    ...(canManageAccess ? [{ icon: ShieldCheck, label: 'حقوق دسترسی', panel: 'access' as Panel, color: 'text-green-500' }] : []),
    { icon: Trash2, label: 'حذف گروه', panel: 'delete' as Panel, color: g.is_system ? 'text-gray-300' : 'text-red-500' },
  ];`,
  `  const menuItems = (g: UserGroup) => [
    ...(isAdmin ? [{ icon: Edit2, label: 'ویرایش گروه', panel: 'edit' as Panel, color: 'text-blue-500' }] : []),
    ...(canManageAccess ? [{ icon: Users, label: 'مدیریت اعضا', panel: 'members' as Panel, color: 'text-teal-500' }] : []),
    ...(canManageAccess ? [{ icon: ShieldCheck, label: 'حقوق دسترسی', panel: 'access' as Panel, color: 'text-green-500' }] : []),
    ...(isAdmin ? [{ icon: Trash2, label: 'حذف گروه', panel: 'delete' as Panel, color: g.is_system ? 'text-gray-300' : 'text-red-500' }] : []),
  ];`,
);
replaceOnce(
  'src/components/UserGroupsPanel.tsx',
  `  if (panel === 'members' && selected) return <MembersPanel group={selected} onBack={goBack} />;`,
  `  if (panel === 'members' && selected) return canManageAccess ? <MembersPanel group={selected} onBack={goBack} /> : <AccessDenied onReturn={goBack} />;`,
);
replaceOnce(
  'src/components/UserGroupsPanel.tsx',
  `          <button onClick={() => setPanel('add')}
            className="flex items-center gap-2 px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-xl text-sm font-medium transition-colors">
            <Plus className="w-4 h-4" />گروه جدید
          </button>`,
  `          {isAdmin && (
            <button onClick={() => setPanel('add')}
              className="flex items-center gap-2 px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-xl text-sm font-medium transition-colors">
              <Plus className="w-4 h-4" />گروه جدید
            </button>
          )}`,
);

const migration = `-- Delegate configuration backend operations to the exact RBAC permissions.
-- This is additive; the already-applied granular configuration migration is not edited.

CREATE OR REPLACE FUNCTION public.has_current_permission_v1(p_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT private.current_user_has_permission_v1(p_key)
$$;
REVOKE ALL ON FUNCTION public.has_current_permission_v1(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_current_permission_v1(text) TO authenticated, service_role;

-- Configuration pages that select user groups for routing/recipients need read access to the group catalogue.
DROP POLICY IF EXISTS config_permission_user_groups_select ON public.user_groups;
CREATE POLICY config_permission_user_groups_select ON public.user_groups
FOR SELECT TO authenticated USING (
  private.current_user_has_permission_v1('config_users.user_groups') OR
  private.current_user_has_permission_v1('config_users.users_list.permissions') OR
  private.current_user_has_permission_v1('config_users.user_groups.permissions') OR
  private.current_user_has_permission_v1('config_notifications.notifications') OR
  private.current_user_has_permission_v1('config_notifications.sms') OR
  private.current_user_has_permission_v1('config_notifications.daily_report')
);

-- Monitoring permission is intentionally read-only: it grants system-wide visibility, not mutation.
DROP POLICY IF EXISTS config_monitoring_profiles_select ON public.profiles;
CREATE POLICY config_monitoring_profiles_select ON public.profiles FOR SELECT TO authenticated
USING (private.current_user_has_permission_v1('config_modules.monitoring'));
DROP POLICY IF EXISTS config_monitoring_meetings_select ON public.meetings;
CREATE POLICY config_monitoring_meetings_select ON public.meetings FOR SELECT TO authenticated
USING (private.current_user_has_permission_v1('config_modules.monitoring'));
DROP POLICY IF EXISTS config_monitoring_participants_select ON public.participants;
CREATE POLICY config_monitoring_participants_select ON public.participants FOR SELECT TO authenticated
USING (private.current_user_has_permission_v1('config_modules.monitoring'));
DROP POLICY IF EXISTS config_monitoring_actions_select ON public.actions;
CREATE POLICY config_monitoring_actions_select ON public.actions FOR SELECT TO authenticated
USING (private.current_user_has_permission_v1('config_modules.monitoring'));
DROP POLICY IF EXISTS config_monitoring_shared_meetings_select ON public.shared_meetings;
CREATE POLICY config_monitoring_shared_meetings_select ON public.shared_meetings FOR SELECT TO authenticated
USING (private.current_user_has_permission_v1('config_modules.monitoring'));
DROP POLICY IF EXISTS config_monitoring_tasks_select ON public.tasks;
CREATE POLICY config_monitoring_tasks_select ON public.tasks FOR SELECT TO authenticated
USING (private.current_user_has_permission_v1('config_modules.monitoring'));
DROP POLICY IF EXISTS config_monitoring_task_workflow_select ON public.task_workflow;
CREATE POLICY config_monitoring_task_workflow_select ON public.task_workflow FOR SELECT TO authenticated
USING (private.current_user_has_permission_v1('config_modules.monitoring'));
DROP POLICY IF EXISTS config_monitoring_channel_group_tasks_select ON public.channel_group_tasks;
CREATE POLICY config_monitoring_channel_group_tasks_select ON public.channel_group_tasks FOR SELECT TO authenticated
USING (private.current_user_has_permission_v1('config_modules.monitoring'));
DROP POLICY IF EXISTS config_monitoring_channels_select ON public.channels;
CREATE POLICY config_monitoring_channels_select ON public.channels FOR SELECT TO authenticated
USING (private.current_user_has_permission_v1('config_modules.monitoring'));
DROP POLICY IF EXISTS config_monitoring_chat_conversations_select ON public.chat_conversations;
CREATE POLICY config_monitoring_chat_conversations_select ON public.chat_conversations FOR SELECT TO authenticated
USING (private.current_user_has_permission_v1('config_modules.monitoring'));
DROP POLICY IF EXISTS config_monitoring_chat_messages_select ON public.chat_messages;
CREATE POLICY config_monitoring_chat_messages_select ON public.chat_messages FOR SELECT TO authenticated
USING (private.current_user_has_permission_v1('config_modules.monitoring'));
DROP POLICY IF EXISTS config_monitoring_channel_messages_select ON public.channel_messages;
CREATE POLICY config_monitoring_channel_messages_select ON public.channel_messages FOR SELECT TO authenticated
USING (private.current_user_has_permission_v1('config_modules.monitoring'));

-- Reuse the existing phone-auth implementations exactly, changing only their authorization guard.
DO $migration_guard$
DECLARE
  v_oid oid;
  v_def text;
  v_old text := 'IF NOT FOUND OR NOT v_is_active OR NOT v_is_admin THEN';
  v_new text := 'IF NOT FOUND OR NOT v_is_active OR (NOT v_is_admin AND NOT private.current_user_has_permission_v1(''config_access.security'')) THEN';
BEGIN
  SELECT p.oid INTO v_oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='private' AND p.proname='get_phone_auth_admin_status' AND pg_get_function_identity_arguments(p.oid)='';
  IF v_oid IS NULL THEN RAISE EXCEPTION 'get_phone_auth_admin_status not found'; END IF;
  SELECT pg_get_functiondef(v_oid) INTO v_def;
  IF strpos(v_def, v_old)=0 THEN RAISE EXCEPTION 'phone status authorization guard changed unexpectedly'; END IF;
  EXECUTE replace(v_def, v_old, v_new);

  SELECT p.oid INTO v_oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='private' AND p.proname='set_phone_auth_canonical_flags'
    AND pg_get_function_identity_arguments(p.oid)='p_login_enabled boolean, p_recovery_enabled boolean';
  IF v_oid IS NULL THEN RAISE EXCEPTION 'set_phone_auth_canonical_flags not found'; END IF;
  SELECT pg_get_functiondef(v_oid) INTO v_def;
  IF strpos(v_def, v_old)=0 THEN RAISE EXCEPTION 'phone flag authorization guard changed unexpectedly'; END IF;
  EXECUTE replace(v_def, v_old, v_new);
END
$migration_guard$;
`;
write('supabase/migrations/20260819024500_delegate_config_backend_operations.sql', migration);

const test = `import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (p: string) => fs.readFileSync(p, 'utf8');

test('delegated config Edge Functions use exact RBAC keys', () => {
  assert.match(read('supabase/functions/backup-data/index.ts'), /hasCurrentPermission\(auth, "config_backup"\)/);
  assert.match(read('supabase/functions/restore-backup/index.ts'), /hasCurrentPermission\(auth, "config_backup"\)/);
  assert.match(read('supabase/functions/send-daily-meetings/dailyReportSupport.ts'), /config_notifications\.daily_report/);
  assert.match(read('supabase/functions/messenger-proxy/index.ts'), /config_notifications\.social_notifications/);
  assert.match(read('supabase/functions/check-phone-password-reset-runtime/index.ts'), /config_access\.security/);
  assert.match(read('supabase/functions/send-sms/index.ts'), /config_notifications\.sms/);
});

test('special identity-repair gate remains untouched', () => {
  const source = read('src/components/PortalConfig/IdentityRepairCard.tsx');
  assert.match(source, /is_security_admin/);
  assert.match(source, /MFA_STEP_UP_REQUIRED|mfa/i);
});

test('delegated group rights do not expose group metadata mutation', () => {
  const source = read('src/components/UserGroupsPanel.tsx');
  assert.match(source, /isAdmin.*ویرایش گروه/s);
  assert.match(source, /canManageAccess.*مدیریت اعضا/s);
  assert.match(source, /canManageAccess.*حقوق دسترسی/s);
});
`;
write('tests/app/configBackendPermissions.test.ts', test);

console.log('Second-stage configuration permission alignment prepared.');
