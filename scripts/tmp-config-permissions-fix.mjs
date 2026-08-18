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
  if (count !== 1) throw new Error(`${file}: expected exactly one match, got ${count}`);
  write(file, value.replace(before, after));
};

const helper = `export const CONFIG_SECTION_PERMISSION: Record<string, string> = {
  general: 'config_platform.general',
  appearance: 'config_platform.appearance',
  regional: 'config_platform.regional',
  ui_settings: 'config_platform.ui_settings',
  users_list: 'config_users.users_list',
  users_online: 'config_users.users_online',
  user_groups: 'config_users.user_groups',
  group_events: 'config_users.group_events',
  org_structure: 'config_users.org_structure',
  security: 'config_access.security',
  server: 'config_access.server',
  backup: 'config_backup',
  audit_log: 'config_audit.audit_log',
  notifications: 'config_notifications.notifications',
  sms: 'config_notifications.sms',
  social_notifications: 'config_notifications.social_notifications',
  email: 'config_notifications.email',
  daily_report: 'config_notifications.daily_report',
  video_conference: 'config_modules.video_conference',
  calendar: 'config_modules.calendar',
  minutes_config: 'config_modules.minutes_config',
  monitoring: 'config_modules.monitoring',
  spark_config: 'config_spark.spark_config',
};

export const CONFIG_SECTION_PERMISSION_KEYS = Object.values(CONFIG_SECTION_PERMISSION);

export function canOpenPortalConfig(
  isAdmin: boolean,
  userPermissions: Record<string, boolean> | null | undefined,
): boolean {
  if (isAdmin || userPermissions === null) return true;
  if (!userPermissions) return false;
  return userPermissions.config_view === true;
}

export function canAccessConfigSection(
  sectionKey: string,
  isAdmin: boolean,
  userPermissions: Record<string, boolean> | null | undefined,
): boolean {
  if (isAdmin || userPermissions === null) return true;
  if (!userPermissions) return false;
  const permissionKey = CONFIG_SECTION_PERMISSION[sectionKey];
  return permissionKey ? userPermissions[permissionKey] === true : false;
}

export function getVisibleConfigNavigationItems<
  T extends { sub: Array<{ key: string }> },
>(
  items: T[],
  isAdmin: boolean,
  userPermissions: Record<string, boolean> | null | undefined,
): T[] {
  return items
    .map((group) => ({
      ...group,
      sub: group.sub.filter((item) =>
        canAccessConfigSection(item.key, isAdmin, userPermissions)
      ),
    }))
    .filter((group) => group.sub.length > 0) as T[];
}

export function getFirstVisibleConfigSection<
  T extends { sub: Array<{ key: string }> },
>(items: T[]): string | null {
  return items[0]?.sub[0]?.key ?? null;
}
`;
write('src/features/permissions/configPermissions.ts', helper);

// Expand the configuration permission registry without touching unrelated groups.
{
  const file = 'src/features/permissions/permissionRegistry.ts';
  const value = read(file);
  const startMarker = "  {\n    label: 'پیکربندی سیستم — دسترسی',";
  const endMarker = "  },\n];\n\nexport const ALL_PERMISSION_ITEMS";
  const start = value.indexOf(startMarker);
  const end = value.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error(`${file}: configuration registry block not found`);
  const block = `  {
    label: 'پیکربندی سیستم — دسترسی',
    color: 'text-red-600',
    items: [
      { key: 'config_view', label: 'ورود به پیکربندی', description: 'مشاهده آیکون و ورود به پرتال پیکربندی', category: 'پیکربندی سیستم — دسترسی', isSensitive: true },
      { key: 'config_platform', label: 'تنظیمات پلتفرم (قدیمی)', description: 'کلید سازگاری برای دسترسی‌های قبلی؛ زیرصفحه‌ها به صورت مستقل کنترل می‌شوند', category: 'پیکربندی سیستم — دسترسی', isSensitive: true },
      { key: 'config_platform.general', label: 'پیکربندی / تنظیمات پلتفرم / تنظیمات کلی', description: 'دسترسی به تنظیمات کلی سامانه', category: 'پیکربندی سیستم — دسترسی', parentModule: 'config_platform', isSensitive: true },
      { key: 'config_platform.appearance', label: 'پیکربندی / تنظیمات پلتفرم / ظاهر و برندینگ', description: 'دسترسی به ظاهر، برندینگ و دارایی‌های پرتال', category: 'پیکربندی سیستم — دسترسی', parentModule: 'config_platform', isSensitive: true },
      { key: 'config_platform.regional', label: 'پیکربندی / تنظیمات پلتفرم / تنظیمات منطقه‌ای', description: 'دسترسی به تنظیمات منطقه‌ای و روزهای کاری', category: 'پیکربندی سیستم — دسترسی', parentModule: 'config_platform', isSensitive: true },
      { key: 'config_platform.ui_settings', label: 'پیکربندی / تنظیمات پلتفرم / تنظیمات محیطی', description: 'دسترسی به تنظیمات رابط کاربری', category: 'پیکربندی سیستم — دسترسی', parentModule: 'config_platform', isSensitive: true },
      { key: 'config_users', label: 'کاربران (قدیمی)', description: 'کلید سازگاری برای دسترسی‌های قبلی؛ زیرصفحه‌ها به صورت مستقل کنترل می‌شوند', category: 'پیکربندی سیستم — دسترسی', isSensitive: true },
      { key: 'config_users.users_list', label: 'پیکربندی / کاربران / فهرست کاربران', description: 'مشاهده فهرست و اطلاعات مدیریتی کاربران', category: 'پیکربندی سیستم — دسترسی', parentModule: 'config_users', isSensitive: true },
      { key: 'config_users.users_list.permissions', label: 'پیکربندی / کاربران / فهرست کاربران / حقوق دسترسی', description: 'مدیریت عضویت گروهی و حقوق دسترسی کاربران', category: 'پیکربندی سیستم — دسترسی', parentModule: 'config_users.users_list', isSensitive: true },
      { key: 'config_users.users_online', label: 'پیکربندی / کاربران / کاربران آنلاین', description: 'مشاهده کاربران آنلاین', category: 'پیکربندی سیستم — دسترسی', parentModule: 'config_users', isSensitive: true },
      { key: 'config_users.user_groups', label: 'پیکربندی / کاربران / گروه‌های کاربری', description: 'مشاهده گروه‌های کاربری', category: 'پیکربندی سیستم — دسترسی', parentModule: 'config_users', isSensitive: true },
      { key: 'config_users.user_groups.permissions', label: 'پیکربندی / کاربران / گروه‌های کاربری / حقوق دسترسی', description: 'ویرایش ماتریس حقوق دسترسی گروه‌های کاربری', category: 'پیکربندی سیستم — دسترسی', parentModule: 'config_users.user_groups', isSensitive: true },
      { key: 'config_users.group_events', label: 'پیکربندی / کاربران / رخدادها', description: 'مشاهده رخدادهای گروه‌ها', category: 'پیکربندی سیستم — دسترسی', parentModule: 'config_users', isSensitive: true },
      { key: 'config_users.org_structure', label: 'پیکربندی / کاربران / ساختار سازمانی', description: 'دسترسی به ساختار سازمانی', category: 'پیکربندی سیستم — دسترسی', parentModule: 'config_users', isSensitive: true },
      { key: 'config_users.org_structure.permissions', label: 'پیکربندی / کاربران / ساختار سازمانی / سطح دسترسی', description: 'مدیریت دسترسی سطح سازمانی و سمت‌ها', category: 'پیکربندی سیستم — دسترسی', parentModule: 'config_users.org_structure', isSensitive: true },
      { key: 'config_access', label: 'حقوق دسترسی (قدیمی)', description: 'کلید سازگاری برای دسترسی‌های قبلی', category: 'پیکربندی سیستم — دسترسی', isSensitive: true },
      { key: 'config_access.security', label: 'پیکربندی / حقوق دسترسی / امنیت و دسترسی', description: 'دسترسی به تنظیمات امنیتی و احراز هویت', category: 'پیکربندی سیستم — دسترسی', parentModule: 'config_access', isSensitive: true },
      { key: 'config_access.server', label: 'پیکربندی / حقوق دسترسی / دسترسی سرور', description: 'دسترسی به تنظیمات سرور', category: 'پیکربندی سیستم — دسترسی', parentModule: 'config_access', isSensitive: true },
      { key: 'config_backup', label: 'پیکربندی / حقوق دسترسی / پشتیبان‌گیری', description: 'دسترسی به پشتیبان‌گیری و بازگردانی', category: 'پیکربندی سیستم — دسترسی', isSensitive: true },
      { key: 'config_audit', label: 'رخدادها (قدیمی)', description: 'کلید سازگاری برای دسترسی‌های قبلی', category: 'پیکربندی سیستم — دسترسی', isSensitive: true },
      { key: 'config_audit.audit_log', label: 'پیکربندی / رویدادها / گزارش رخدادها', description: 'مشاهده گزارش رخدادهای مدیریتی و امنیتی', category: 'پیکربندی سیستم — دسترسی', parentModule: 'config_audit', isSensitive: true },
      { key: 'config_notifications', label: 'اعلان‌ها و پیامک (قدیمی)', description: 'کلید سازگاری برای دسترسی‌های قبلی', category: 'پیکربندی سیستم — دسترسی', isSensitive: true },
      { key: 'config_notifications.notifications', label: 'پیکربندی / اعلان‌ها و پیامک / اعلان‌ها', description: 'مدیریت قواعد، قالب‌ها و گزارش اعلان‌ها', category: 'پیکربندی سیستم — دسترسی', parentModule: 'config_notifications', isSensitive: true },
      { key: 'config_notifications.sms', label: 'پیکربندی / اعلان‌ها و پیامک / پیامک', description: 'مدیریت ارائه‌دهنده، قالب و قواعد پیامک', category: 'پیکربندی سیستم — دسترسی', parentModule: 'config_notifications', isSensitive: true },
      { key: 'config_notifications.social_notifications', label: 'پیکربندی / اعلان‌ها و پیامک / شبکه‌های اجتماعی', description: 'مدیریت کانال‌های اعلان اجتماعی', category: 'پیکربندی سیستم — دسترسی', parentModule: 'config_notifications', isSensitive: true },
      { key: 'config_notifications.email', label: 'پیکربندی / اعلان‌ها و پیامک / پست الکترونیک', description: 'مدیریت تنظیمات پست الکترونیک', category: 'پیکربندی سیستم — دسترسی', parentModule: 'config_notifications', isSensitive: true },
      { key: 'config_notifications.daily_report', label: 'پیکربندی / اعلان‌ها و پیامک / ارسال جلسات مدیریتی', description: 'مدیریت تنظیمات گزارش روزانه جلسات', category: 'پیکربندی سیستم — دسترسی', parentModule: 'config_notifications', isSensitive: true },
      { key: 'config_modules', label: 'مدیریت موجودیت‌ها (قدیمی)', description: 'کلید سازگاری برای دسترسی‌های قبلی', category: 'پیکربندی سیستم — دسترسی', isSensitive: true },
      { key: 'config_modules.video_conference', label: 'پیکربندی / مدیریت موجودیت‌ها / ویدیو کنفرانس', description: 'مدیریت تنظیمات ویدیو کنفرانس', category: 'پیکربندی سیستم — دسترسی', parentModule: 'config_modules', isSensitive: true },
      { key: 'config_modules.calendar', label: 'پیکربندی / مدیریت موجودیت‌ها / تقویم و مناسبت‌ها', description: 'مدیریت تنظیمات و مناسبت‌های تقویم', category: 'پیکربندی سیستم — دسترسی', parentModule: 'config_modules', isSensitive: true },
      { key: 'config_modules.minutes_config', label: 'پیکربندی / مدیریت موجودیت‌ها / صورت‌جلسات و مصوبات', description: 'مدیریت پیکربندی صورت‌جلسات و مصوبات', category: 'پیکربندی سیستم — دسترسی', parentModule: 'config_modules', isSensitive: true },
      { key: 'config_modules.monitoring', label: 'پیکربندی / مدیریت موجودیت‌ها / مانیتورینگ سیستم', description: 'دسترسی به مانیتورینگ سیستم', category: 'پیکربندی سیستم — دسترسی', parentModule: 'config_modules', isSensitive: true },
      { key: 'config_spark', label: 'دستیار اسپارک (قدیمی)', description: 'کلید سازگاری برای دسترسی‌های قبلی', category: 'پیکربندی سیستم — دسترسی', isSensitive: true },
      { key: 'config_spark.spark_config', label: 'پیکربندی / دستیار اسپارک / پیکربندی اسپارک', description: 'مدیریت تنظیمات دستیار اسپارک', category: 'پیکربندی سیستم — دسترسی', parentModule: 'config_spark', isSensitive: true },
    ],
`;
  write(file, value.slice(0, start) + block + value.slice(end));
}

// Configuration navigation is permission-driven, not admin-only.
replaceOnce(
  'src/app/layout/components/LayoutTopBar.tsx',
  "import { ProfileDropdown } from './ProfileDropdown';",
  "import { ProfileDropdown } from './ProfileDropdown';\nimport { usePermissions } from '../../../context/PermissionsContext';\nimport { canOpenPortalConfig } from '../../../features/permissions/configPermissions';",
);
replaceOnce(
  'src/app/layout/components/LayoutTopBar.tsx',
  "export function LayoutTopBar({\n  userProfile,\n  onPageChange,\n  onLogout,\n  isAdmin,\n  activePage,\n  accentColor,\n  installPrompt,\n  onPromptInstall,\n}: LayoutTopBarProps) {\n  return (",
  "export function LayoutTopBar({\n  userProfile,\n  onPageChange,\n  onLogout,\n  isAdmin,\n  activePage,\n  accentColor,\n  installPrompt,\n  onPromptInstall,\n}: LayoutTopBarProps) {\n  const { userPermissions } = usePermissions();\n  const showPortalConfig = canOpenPortalConfig(isAdmin, userPermissions);\n\n  return (",
);
replaceOnce(
  'src/app/layout/components/LayoutTopBar.tsx',
  "          {isAdmin && (\n            <PortalButton",
  "          {showPortalConfig && (\n            <PortalButton",
);

replaceOnce(
  'src/app/navigation/PageRenderer.tsx',
  "import { PAGE_PERMISSION_KEY, checkPermission, AccessDenied } from '../../features/permissions';",
  "import { PAGE_PERMISSION_KEY, checkPermission, AccessDenied } from '../../features/permissions';\nimport { canOpenPortalConfig } from '../../features/permissions/configPermissions';",
);
replaceOnce(
  'src/app/navigation/PageRenderer.tsx',
  "    case 'portal-config':\n      return isAdmin && currentUserId ? modernPage(<PortalConfigPage currentUserId={currentUserId} />) : null;",
  "    case 'portal-config':\n      return currentUserId && canOpenPortalConfig(isAdmin, userPermissions)\n        ? modernPage(<PortalConfigPage currentUserId={currentUserId} />)\n        : <AccessDenied onReturn={() => navigate('profile')} />;",
);

replaceOnce(
  'src/AuthenticatedApp.tsx',
  "import { AuthenticatedThemeSync } from './context/AuthenticatedThemeSync';\n\nconst PortalConfigPage = lazy(() =>\n  import('./components/PortalConfigPage').then((m) => ({ default: m.PortalConfigPage })),\n);",
  "import { AuthenticatedThemeSync } from './context/AuthenticatedThemeSync';\nimport { canOpenPortalConfig } from './features/permissions/configPermissions';",
);
replaceOnce(
  'src/AuthenticatedApp.tsx',
  "  useAdminPathGuard(true, isAdmin, navigate);",
  "  const canOpenConfig = canOpenPortalConfig(isAdmin, userPermissions);\n  useAdminPathGuard(true, canOpenConfig, navigate);",
);
{
  const file = 'src/AuthenticatedApp.tsx';
  const value = read(file);
  const start = value.indexOf("  if (activePage === 'admin' && isAdmin) {");
  const end = value.indexOf("\n  if (maintenanceMode && !isAdmin) {", start);
  if (start < 0 || end < 0) throw new Error(`${file}: legacy admin rendering block not found`);
  write(file, value.slice(0, start) + value.slice(end + 1));
}

replaceOnce(
  'src/app/navigation/useNavigation.ts',
  "  isAdmin: boolean,\n  navigate: (page: PageId) => void,",
  "  hasConfigAccess: boolean,\n  navigate: (page: PageId) => void,",
);
replaceOnce(
  'src/app/navigation/useNavigation.ts',
  "        if (isAuthenticated && isAdmin) {\n          navigate('admin');\n        } else if (isAuthenticated && !isAdmin) {\n          window.history.pushState({}, '', '/');\n          toast.error('شما دسترسی به پنل ادمین ندارید');\n        }",
  "        if (isAuthenticated && hasConfigAccess) {\n          navigate('portal-config');\n        } else if (isAuthenticated && !hasConfigAccess) {\n          window.history.pushState({}, '', '/');\n          toast.error('شما دسترسی به پیکربندی ندارید');\n        }",
);
replaceOnce(
  'src/app/navigation/useNavigation.ts',
  "  }, [isAuthenticated, isAdmin, navigate]);",
  "  }, [isAuthenticated, hasConfigAccess, navigate]);",
);

// Filter every configuration sub-page by its dedicated permission.
replaceOnce(
  'src/components/PortalConfigPage.tsx',
  "import type { ConfigEntry, Profile, Props } from './PortalConfig/types';",
  "import type { ConfigEntry, Profile, Props } from './PortalConfig/types';\nimport { usePermissions } from '../context/PermissionsContext';\nimport { canAccessConfigSection, getFirstVisibleConfigSection, getVisibleConfigNavigationItems } from '../features/permissions/configPermissions';",
);
replaceOnce(
  'src/components/PortalConfigPage.tsx',
  "export function PortalConfigPage({ currentUserId }: Props) {\n  const [activeSection, setActiveSection] = useState('general');",
  "export function PortalConfigPage({ currentUserId }: Props) {\n  const { isAdmin, userPermissions } = usePermissions();\n  const [activeSection, setActiveSection] = useState('general');",
);
replaceOnce(
  'src/components/PortalConfigPage.tsx',
  "  const [uploadingKey, setUploadingKey] = useState<string | null>(null);\n\n  // Load configs",
  "  const [uploadingKey, setUploadingKey] = useState<string | null>(null);\n  const visibleNavItems = getVisibleConfigNavigationItems(NAV_ITEMS, isAdmin, userPermissions);\n  const firstVisibleSection = getFirstVisibleConfigSection(visibleNavItems);\n  const canAccessActiveSection = canAccessConfigSection(activeSection, isAdmin, userPermissions);\n\n  useEffect(() => {\n    if (!canAccessActiveSection && firstVisibleSection) setActiveSection(firstVisibleSection);\n  }, [activeSection, canAccessActiveSection, firstVisibleSection]);\n\n  // Load configs",
);
replaceOnce(
  'src/components/PortalConfigPage.tsx',
  "  const renderContent = () => {\n    switch (activeSection) {",
  "  const renderContent = () => {\n    if (!canAccessActiveSection) {\n      return <div className=\"py-20 text-center text-sm text-gray-500 dark:text-gray-400\">برای این بخش مجوز دسترسی ندارید.</div>;\n    }\n    switch (activeSection) {",
);
replaceOnce(
  'src/components/PortalConfigPage.tsx',
  "    for (const group of NAV_ITEMS) {",
  "    for (const group of visibleNavItems) {",
);
replaceOnce(
  'src/components/PortalConfigPage.tsx',
  "      {NAV_ITEMS.map(group => {",
  "      {visibleNavItems.map(group => {",
);

// The three requested nested rights are independently gated in the UI.
replaceOnce(
  'src/components/UserManagementPanel.tsx',
  "import { useDismissOnOutsideClick } from '../shared/ui/useDismissOnOutsideClick';",
  "import { useDismissOnOutsideClick } from '../shared/ui/useDismissOnOutsideClick';\nimport { usePermissions } from '../context/PermissionsContext';\nimport { AccessDenied } from '../features/permissions';",
);
replaceOnce(
  'src/components/UserManagementPanel.tsx',
  "export function UserManagementPanel({ currentUserId }: Props) {\n  const [profiles, setProfiles] = useState<AdminProfile[]>([]);",
  "export function UserManagementPanel({ currentUserId }: Props) {\n  const { hasPermission } = usePermissions();\n  const canManageAccess = hasPermission('config_users.users_list.permissions');\n  const [profiles, setProfiles] = useState<AdminProfile[]>([]);",
);
replaceOnce(
  'src/components/UserManagementPanel.tsx',
  "  if (panel === 'access' && selectedUser) return <AccessPanel user={selectedUser} onBack={goBack} />;",
  "  if (panel === 'access' && selectedUser) return canManageAccess ? <AccessPanel user={selectedUser} onBack={goBack} /> : <AccessDenied onReturn={goBack} />;",
);
replaceOnce(
  'src/components/UserManagementPanel.tsx',
  "menuItems(p).map(({ icon: Icon, label, panel: target, color }) => (",
  "menuItems(p).filter(item => item.panel !== 'access' || canManageAccess).map(({ icon: Icon, label, panel: target, color }) => (",
);

replaceOnce(
  'src/components/UserGroupsPanel.tsx',
  "import { useDismissOnOutsideClick } from '../shared/ui/useDismissOnOutsideClick';",
  "import { useDismissOnOutsideClick } from '../shared/ui/useDismissOnOutsideClick';\nimport { usePermissions } from '../context/PermissionsContext';\nimport { AccessDenied } from '../features/permissions';",
);
replaceOnce(
  'src/components/UserGroupsPanel.tsx',
  "export function UserGroupsPanel({}: Props) {\n  const [groups, setGroups] = useState<UserGroup[]>([]);",
  "export function UserGroupsPanel({}: Props) {\n  const { hasPermission } = usePermissions();\n  const canManageAccess = hasPermission('config_users.user_groups.permissions');\n  const [groups, setGroups] = useState<UserGroup[]>([]);",
);
replaceOnce(
  'src/components/UserGroupsPanel.tsx',
  "    { icon: ShieldCheck, label: 'حقوق دسترسی', panel: 'access' as Panel, color: 'text-green-500' },",
  "    ...(canManageAccess ? [{ icon: ShieldCheck, label: 'حقوق دسترسی', panel: 'access' as Panel, color: 'text-green-500' }] : []),",
);
replaceOnce(
  'src/components/UserGroupsPanel.tsx',
  "  if (panel === 'access' && selected) return <AccessPanel group={selected} onBack={goBack} />;",
  "  if (panel === 'access' && selected) return canManageAccess ? <AccessPanel group={selected} onBack={goBack} /> : <AccessDenied onReturn={goBack} />;",
);

replaceOnce(
  'src/components/OrgStructurePage.tsx',
  "import { OrgFormModal, type OrgFormState } from './OrgStructure/OrgFormModal';",
  "import { OrgFormModal, type OrgFormState } from './OrgStructure/OrgFormModal';\nimport { usePermissions } from '../context/PermissionsContext';",
);
replaceOnce(
  'src/components/OrgStructurePage.tsx',
  "export function OrgStructurePage() {\n  const [org, setOrg] = useState<OrgOrganization | null>(null);",
  "export function OrgStructurePage() {\n  const { hasPermission } = usePermissions();\n  const canManagePermissions = hasPermission('config_users.org_structure.permissions');\n  const [org, setOrg] = useState<OrgOrganization | null>(null);",
);
replaceOnce(
  'src/components/OrgStructurePage.tsx',
  "        ].map(tab => (",
  "        ].filter(tab => tab.key !== 'permissions' || canManagePermissions).map(tab => (",
);
replaceOnce(
  'src/components/OrgStructurePage.tsx',
  "      {activeTab === 'permissions' && (\n        <OrgPermissionsPanel positions={positions} levelDefs={levelDefs} />\n      )}",
  "      {activeTab === 'permissions' && canManagePermissions && (\n        <OrgPermissionsPanel positions={positions} levelDefs={levelDefs} />\n      )}",
);

// Keep the effective permission display correct: group + level + position, not groups only.
replaceOnce(
  'src/components/UserManagement/AccessPanel.tsx',
  "import {\n  PERMISSION_REGISTRY,",
  "import { loadResolvedUserPermissions } from '../../features/permissions';\nimport {\n  PERMISSION_REGISTRY,",
);
replaceOnce(
  'src/components/UserManagement/AccessPanel.tsx',
  "  const [reloadKey, setReloadKey] = useState(0);",
  "  const [reloadKey, setReloadKey] = useState(0);\n  const [resolvedPermissions, setResolvedPermissions] = useState<Record<string, boolean> | null | undefined>(undefined);",
);
replaceOnce(
  'src/components/UserManagement/AccessPanel.tsx',
  "  useEffect(() => { loadGroups(); }, [loadGroups, reloadKey]);",
  "  useEffect(() => { loadGroups(); }, [loadGroups, reloadKey]);\n  useEffect(() => {\n    let alive = true;\n    void loadResolvedUserPermissions(user.user_id).then((permissions) => {\n      if (alive) setResolvedPermissions(permissions);\n    });\n    return () => { alive = false; };\n  }, [user.user_id, reloadKey]);",
);
replaceOnce(
  'src/components/UserManagement/AccessPanel.tsx',
  "    if (user.is_admin) return { has: true, source: 'ادمین' };\n\n    const grantingGroups = groups.filter(g => g.permissions[key] === true);",
  "    if (user.is_admin || resolvedPermissions === null) return { has: true, source: user.is_admin ? 'ادمین' : 'دسترسی کامل' };\n    if (resolvedPermissions?.[key] === true) return { has: true, source: 'دسترسی مؤثر' };\n\n    const grantingGroups = groups.filter(g => g.permissions[key] === true);",
);

// Dashboard now crosses the existing security boundary through an authenticated Edge Function.
replaceOnce(
  'src/components/ManagementDashboardPage.tsx',
  "      const { data: rpcData, error } = await supabase.rpc('get_management_dashboard_v1');\n      if (error) throw error;\n      const normalized = normalizeDashboardData(rpcData);",
  "      const { data: functionData, error } = await supabase.functions.invoke('management-dashboard');\n      if (error) throw error;\n      const normalized = normalizeDashboardData(functionData?.data);",
);

const edgeFunction = `import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2.111.0";
import { deniedResponse, requireFullAuthAccess } from "../_shared/requireFullAuthAccess.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
  "Content-Type": "application/json",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "METHOD_NOT_ALLOWED" }), { status: 405, headers: corsHeaders });
  }

  const auth = await requireFullAuthAccess(req);
  if (!auth.ok || !auth.userId) return deniedResponse();

  const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await service.rpc("get_management_dashboard_for_user_v1", {
    p_user_id: auth.userId,
  });

  if (error) {
    const forbidden = error.message?.includes("MANAGEMENT_DASHBOARD_FORBIDDEN");
    return new Response(JSON.stringify({ error: forbidden ? "MANAGEMENT_DASHBOARD_FORBIDDEN" : "MANAGEMENT_DASHBOARD_FAILED" }), {
      status: forbidden ? 403 : 500,
      headers: corsHeaders,
    });
  }

  return new Response(JSON.stringify({ ok: true, data }), { status: 200, headers: corsHeaders });
});
`;
write('supabase/functions/management-dashboard/index.ts', edgeFunction);

const migration = `-- Granular configuration permissions and secure management-dashboard bridge.
-- Existing migrations are intentionally not modified.

CREATE OR REPLACE FUNCTION private.current_user_has_permission_v1(p_key text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL OR p_key IS NULL OR btrim(p_key) = '' THEN
    RETURN false;
  END IF;
  IF NOT private.is_current_session_fully_authorized() THEN
    RETURN false;
  END IF;
  IF private.is_current_user_admin() THEN
    RETURN true;
  END IF;
  RETURN public._has_permission(v_user_id, p_key);
END;
$$;
REVOKE ALL ON FUNCTION private.current_user_has_permission_v1(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.current_user_has_permission_v1(text) TO authenticated, service_role;

-- Preserve intended access from legacy coarse config permissions without auto-granting
-- the three new rights-administration permissions.
UPDATE public.user_groups SET permissions = permissions || '{"config_platform.general":true,"config_platform.appearance":true,"config_platform.regional":true,"config_platform.ui_settings":true}'::jsonb WHERE permissions @> '{"config_platform":true}'::jsonb;
UPDATE public.user_groups SET permissions = permissions || '{"config_users.users_list":true,"config_users.users_online":true,"config_users.user_groups":true,"config_users.group_events":true,"config_users.org_structure":true}'::jsonb WHERE permissions @> '{"config_users":true}'::jsonb;
UPDATE public.user_groups SET permissions = permissions || '{"config_access.security":true,"config_access.server":true}'::jsonb WHERE permissions @> '{"config_access":true}'::jsonb;
UPDATE public.user_groups SET permissions = permissions || '{"config_audit.audit_log":true}'::jsonb WHERE permissions @> '{"config_audit":true}'::jsonb;
UPDATE public.user_groups SET permissions = permissions || '{"config_notifications.notifications":true,"config_notifications.sms":true,"config_notifications.social_notifications":true,"config_notifications.email":true,"config_notifications.daily_report":true}'::jsonb WHERE permissions @> '{"config_notifications":true}'::jsonb;
UPDATE public.user_groups SET permissions = permissions || '{"config_modules.video_conference":true,"config_modules.calendar":true,"config_modules.minutes_config":true,"config_modules.monitoring":true}'::jsonb WHERE permissions @> '{"config_modules":true}'::jsonb;
UPDATE public.user_groups SET permissions = permissions || '{"config_spark.spark_config":true}'::jsonb WHERE permissions @> '{"config_spark":true}'::jsonb;

-- Dedicated view policies for delegated configuration pages.
DROP POLICY IF EXISTS config_permission_profiles_select ON public.profiles;
CREATE POLICY config_permission_profiles_select ON public.profiles FOR SELECT TO authenticated USING (
  private.current_user_has_permission_v1('config_users.users_list') OR
  private.current_user_has_permission_v1('config_users.users_online') OR
  private.current_user_has_permission_v1('config_users.user_groups') OR
  private.current_user_has_permission_v1('config_users.org_structure') OR
  private.current_user_has_permission_v1('config_users.users_list.permissions') OR
  private.current_user_has_permission_v1('config_users.user_groups.permissions') OR
  private.current_user_has_permission_v1('config_users.org_structure.permissions')
);
DROP POLICY IF EXISTS config_permission_user_groups_select ON public.user_groups;
CREATE POLICY config_permission_user_groups_select ON public.user_groups FOR SELECT TO authenticated USING (
  private.current_user_has_permission_v1('config_users.user_groups') OR
  private.current_user_has_permission_v1('config_users.users_list.permissions') OR
  private.current_user_has_permission_v1('config_users.user_groups.permissions')
);
DROP POLICY IF EXISTS config_permission_user_group_members_select ON public.user_group_members;
CREATE POLICY config_permission_user_group_members_select ON public.user_group_members FOR SELECT TO authenticated USING (
  private.current_user_has_permission_v1('config_users.user_groups') OR
  private.current_user_has_permission_v1('config_users.users_list.permissions') OR
  private.current_user_has_permission_v1('config_users.user_groups.permissions')
);
DROP POLICY IF EXISTS config_permission_user_group_members_insert ON public.user_group_members;
CREATE POLICY config_permission_user_group_members_insert ON public.user_group_members FOR INSERT TO authenticated WITH CHECK (
  private.current_user_has_permission_v1('config_users.users_list.permissions') OR
  private.current_user_has_permission_v1('config_users.user_groups.permissions')
);
DROP POLICY IF EXISTS config_permission_user_group_members_delete ON public.user_group_members;
CREATE POLICY config_permission_user_group_members_delete ON public.user_group_members FOR DELETE TO authenticated USING (
  private.current_user_has_permission_v1('config_users.users_list.permissions') OR
  private.current_user_has_permission_v1('config_users.user_groups.permissions')
);

DROP POLICY IF EXISTS config_permission_org_level_insert ON public.org_level_permissions;
CREATE POLICY config_permission_org_level_insert ON public.org_level_permissions FOR INSERT TO authenticated WITH CHECK (private.current_user_has_permission_v1('config_users.org_structure.permissions'));
DROP POLICY IF EXISTS config_permission_org_level_update ON public.org_level_permissions;
CREATE POLICY config_permission_org_level_update ON public.org_level_permissions FOR UPDATE TO authenticated USING (private.current_user_has_permission_v1('config_users.org_structure.permissions')) WITH CHECK (private.current_user_has_permission_v1('config_users.org_structure.permissions'));
DROP POLICY IF EXISTS config_permission_org_level_delete ON public.org_level_permissions;
CREATE POLICY config_permission_org_level_delete ON public.org_level_permissions FOR DELETE TO authenticated USING (private.current_user_has_permission_v1('config_users.org_structure.permissions'));
DROP POLICY IF EXISTS config_permission_org_position_insert ON public.org_position_permissions;
CREATE POLICY config_permission_org_position_insert ON public.org_position_permissions FOR INSERT TO authenticated WITH CHECK (private.current_user_has_permission_v1('config_users.org_structure.permissions'));
DROP POLICY IF EXISTS config_permission_org_position_update ON public.org_position_permissions;
CREATE POLICY config_permission_org_position_update ON public.org_position_permissions FOR UPDATE TO authenticated USING (private.current_user_has_permission_v1('config_users.org_structure.permissions')) WITH CHECK (private.current_user_has_permission_v1('config_users.org_structure.permissions'));
DROP POLICY IF EXISTS config_permission_org_position_delete ON public.org_position_permissions;
CREATE POLICY config_permission_org_position_delete ON public.org_position_permissions FOR DELETE TO authenticated USING (private.current_user_has_permission_v1('config_users.org_structure.permissions'));

-- System-config sections can be managed only through their exact page permission.
CREATE OR REPLACE FUNCTION private.config_permission_for_system_section_v1(p_section text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE p_section
    WHEN 'general' THEN 'config_platform.general'
    WHEN 'appearance' THEN 'config_platform.appearance'
    WHEN 'regional' THEN 'config_platform.regional'
    WHEN 'ui' THEN 'config_platform.ui_settings'
    WHEN 'security' THEN 'config_access.security'
    WHEN 'server' THEN 'config_access.server'
    WHEN 'email' THEN 'config_notifications.email'
    WHEN 'video_conference' THEN 'config_modules.video_conference'
    WHEN 'calendar' THEN 'config_modules.calendar'
    WHEN 'minutes' THEN 'config_modules.minutes_config'
    WHEN 'spark' THEN 'config_spark.spark_config'
    ELSE NULL
  END
$$;
REVOKE ALL ON FUNCTION private.config_permission_for_system_section_v1(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.config_permission_for_system_section_v1(text) TO authenticated, service_role;
DROP POLICY IF EXISTS config_permission_system_config_select ON public.system_config;
CREATE POLICY config_permission_system_config_select ON public.system_config FOR SELECT TO authenticated USING (private.current_user_has_permission_v1(private.config_permission_for_system_section_v1(section)));
DROP POLICY IF EXISTS config_permission_system_config_insert ON public.system_config;
CREATE POLICY config_permission_system_config_insert ON public.system_config FOR INSERT TO authenticated WITH CHECK (private.current_user_has_permission_v1(private.config_permission_for_system_section_v1(section)));
DROP POLICY IF EXISTS config_permission_system_config_update ON public.system_config;
CREATE POLICY config_permission_system_config_update ON public.system_config FOR UPDATE TO authenticated USING (private.current_user_has_permission_v1(private.config_permission_for_system_section_v1(section))) WITH CHECK (private.current_user_has_permission_v1(private.config_permission_for_system_section_v1(section)));
DROP POLICY IF EXISTS config_permission_system_config_delete ON public.system_config;
CREATE POLICY config_permission_system_config_delete ON public.system_config FOR DELETE TO authenticated USING (private.current_user_has_permission_v1(private.config_permission_for_system_section_v1(section)));

-- Common specialized configuration tables.
DROP POLICY IF EXISTS config_permission_notification_group_rules_all ON public.notification_group_rules;
CREATE POLICY config_permission_notification_group_rules_all ON public.notification_group_rules FOR ALL TO authenticated USING (private.current_user_has_permission_v1('config_notifications.notifications')) WITH CHECK (private.current_user_has_permission_v1('config_notifications.notifications'));
DROP POLICY IF EXISTS config_permission_notification_templates_all ON public.notification_templates;
CREATE POLICY config_permission_notification_templates_all ON public.notification_templates FOR ALL TO authenticated USING (private.current_user_has_permission_v1('config_notifications.notifications')) WITH CHECK (private.current_user_has_permission_v1('config_notifications.notifications'));
DROP POLICY IF EXISTS config_permission_notifications_select ON public.notifications;
CREATE POLICY config_permission_notifications_select ON public.notifications FOR SELECT TO authenticated USING (private.current_user_has_permission_v1('config_notifications.notifications'));
DROP POLICY IF EXISTS config_permission_sms_providers_all ON public.sms_providers;
CREATE POLICY config_permission_sms_providers_all ON public.sms_providers FOR ALL TO authenticated USING (private.current_user_has_permission_v1('config_notifications.sms')) WITH CHECK (private.current_user_has_permission_v1('config_notifications.sms'));
DROP POLICY IF EXISTS config_permission_sms_templates_all ON public.sms_templates;
CREATE POLICY config_permission_sms_templates_all ON public.sms_templates FOR ALL TO authenticated USING (private.current_user_has_permission_v1('config_notifications.sms')) WITH CHECK (private.current_user_has_permission_v1('config_notifications.sms'));
DROP POLICY IF EXISTS config_permission_sms_group_rules_all ON public.sms_group_rules;
CREATE POLICY config_permission_sms_group_rules_all ON public.sms_group_rules FOR ALL TO authenticated USING (private.current_user_has_permission_v1('config_notifications.sms')) WITH CHECK (private.current_user_has_permission_v1('config_notifications.sms'));
DROP POLICY IF EXISTS config_permission_sms_logs_select ON public.sms_dispatch_logs;
CREATE POLICY config_permission_sms_logs_select ON public.sms_dispatch_logs FOR SELECT TO authenticated USING (private.current_user_has_permission_v1('config_notifications.sms'));
DROP POLICY IF EXISTS config_permission_social_channels_all ON public.social_channel_configs;
CREATE POLICY config_permission_social_channels_all ON public.social_channel_configs FOR ALL TO authenticated USING (private.current_user_has_permission_v1('config_notifications.social_notifications')) WITH CHECK (private.current_user_has_permission_v1('config_notifications.social_notifications'));
DROP POLICY IF EXISTS config_permission_daily_report_all ON public.daily_report_config;
CREATE POLICY config_permission_daily_report_all ON public.daily_report_config FOR ALL TO authenticated USING (private.current_user_has_permission_v1('config_notifications.daily_report')) WITH CHECK (private.current_user_has_permission_v1('config_notifications.daily_report'));
DROP POLICY IF EXISTS config_permission_calendar_occasions_all ON public.calendar_occasions;
CREATE POLICY config_permission_calendar_occasions_all ON public.calendar_occasions FOR ALL TO authenticated USING (private.current_user_has_permission_v1('config_modules.calendar')) WITH CHECK (private.current_user_has_permission_v1('config_modules.calendar'));
DROP POLICY IF EXISTS config_permission_audit_log_select ON public.audit_log;
CREATE POLICY config_permission_audit_log_select ON public.audit_log FOR SELECT TO authenticated USING (private.current_user_has_permission_v1('config_audit.audit_log'));
DROP POLICY IF EXISTS config_permission_security_audit_select ON public.security_audit_events;
CREATE POLICY config_permission_security_audit_select ON public.security_audit_events FOR SELECT TO authenticated USING (private.current_user_has_permission_v1('config_audit.audit_log'));
DROP POLICY IF EXISTS config_permission_spark_config_all ON public.spark_config;
CREATE POLICY config_permission_spark_config_all ON public.spark_config FOR ALL TO authenticated USING (private.current_user_has_permission_v1('config_spark.spark_config')) WITH CHECK (private.current_user_has_permission_v1('config_spark.spark_config'));
DROP POLICY IF EXISTS config_permission_spark_ai_settings_all ON public.spark_ai_settings;
CREATE POLICY config_permission_spark_ai_settings_all ON public.spark_ai_settings FOR ALL TO authenticated USING (private.current_user_has_permission_v1('config_spark.spark_config')) WITH CHECK (private.current_user_has_permission_v1('config_spark.spark_config'));
DROP POLICY IF EXISTS config_permission_spark_keywords_all ON public.spark_field_keywords;
CREATE POLICY config_permission_spark_keywords_all ON public.spark_field_keywords FOR ALL TO authenticated USING (private.current_user_has_permission_v1('config_spark.spark_config')) WITH CHECK (private.current_user_has_permission_v1('config_spark.spark_config'));

-- Portal assets are writable only by the two config pages that own them.
DROP POLICY IF EXISTS config_permission_portal_assets_insert ON storage.objects;
CREATE POLICY config_permission_portal_assets_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK (
  bucket_id = 'portal-assets' AND (
    private.current_user_has_permission_v1('config_platform.appearance') OR
    private.current_user_has_permission_v1('config_modules.minutes_config')
  )
);
DROP POLICY IF EXISTS config_permission_portal_assets_update ON storage.objects;
CREATE POLICY config_permission_portal_assets_update ON storage.objects FOR UPDATE TO authenticated USING (
  bucket_id = 'portal-assets' AND (
    private.current_user_has_permission_v1('config_platform.appearance') OR
    private.current_user_has_permission_v1('config_modules.minutes_config')
  )
) WITH CHECK (
  bucket_id = 'portal-assets' AND (
    private.current_user_has_permission_v1('config_platform.appearance') OR
    private.current_user_has_permission_v1('config_modules.minutes_config')
  )
);
DROP POLICY IF EXISTS config_permission_portal_assets_delete ON storage.objects;
CREATE POLICY config_permission_portal_assets_delete ON storage.objects FOR DELETE TO authenticated USING (
  bucket_id = 'portal-assets' AND (
    private.current_user_has_permission_v1('config_platform.appearance') OR
    private.current_user_has_permission_v1('config_modules.minutes_config')
  )
);

-- Allow the dedicated group-rights RPC to be delegated without exposing a SECURITY DEFINER function in public.
CREATE OR REPLACE FUNCTION private.admin_update_user_group_permissions_impl(p_group_id uuid, p_permissions jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_is_admin boolean := false;
  v_group_name text;
  v_group_display_name text;
  v_is_system boolean;
  v_saved_permissions jsonb;
  v_permission_count integer := 0;
BEGIN
  IF v_user_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'NOT_AUTHENTICATED'); END IF;
  IF NOT private.is_current_session_fully_authorized() THEN RETURN jsonb_build_object('ok', false, 'error', 'AUTH_ACCESS_RESTRICTED'); END IF;
  SELECT COALESCE(p.is_admin, false) INTO v_is_admin FROM public.profiles p WHERE p.user_id = v_user_id AND p.account_status = 'ACTIVE' LIMIT 1;
  IF NOT COALESCE(v_is_admin, false) AND NOT private.current_user_has_permission_v1('config_users.user_groups.permissions') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'PERMISSION_REQUIRED');
  END IF;
  IF p_group_id IS NULL OR p_permissions IS NULL OR jsonb_typeof(p_permissions) <> 'object' THEN RETURN jsonb_build_object('ok', false, 'error', 'INVALID_PERMISSIONS'); END IF;
  IF EXISTS (SELECT 1 FROM jsonb_each(p_permissions) e WHERE jsonb_typeof(e.value) <> 'boolean') THEN RETURN jsonb_build_object('ok', false, 'error', 'INVALID_PERMISSION_VALUE'); END IF;
  UPDATE public.user_groups g SET permissions = p_permissions WHERE g.id = p_group_id
    RETURNING g.name, g.display_name, COALESCE(g.is_system, false), g.permissions INTO v_group_name, v_group_display_name, v_is_system, v_saved_permissions;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'GROUP_NOT_FOUND'); END IF;
  SELECT count(*)::integer INTO v_permission_count FROM jsonb_object_keys(v_saved_permissions);
  BEGIN
    INSERT INTO public.security_audit_events (user_id,event_type,event_category,severity,result,metadata)
    VALUES (v_user_id,'user_group_permissions_updated','settings_change','info','success',jsonb_build_object('group_id',p_group_id,'group_name',v_group_name,'group_display_name',v_group_display_name,'is_system',v_is_system,'permission_count',v_permission_count));
  EXCEPTION WHEN others THEN NULL;
  END;
  RETURN jsonb_build_object('ok',true,'group_id',p_group_id,'is_system',v_is_system,'permissions',v_saved_permissions);
END;
$$;
REVOKE ALL ON FUNCTION private.admin_update_user_group_permissions_impl(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.admin_update_user_group_permissions_impl(uuid, jsonb) TO authenticated, service_role;

-- Preserve the hardened SECURITY DEFINER dashboard: browser roles still cannot execute it.
-- The Edge Function authenticates the caller, then service_role invokes this SECURITY INVOKER bridge.
CREATE OR REPLACE FUNCTION public.get_management_dashboard_for_user_v1(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF p_user_id IS NULL THEN RAISE EXCEPTION 'INVALID_USER_ID'; END IF;
  PERFORM set_config('request.jwt.claim.sub', p_user_id::text, true);
  RETURN public.get_management_dashboard_v1();
END;
$$;
REVOKE ALL ON FUNCTION public.get_management_dashboard_for_user_v1(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_management_dashboard_for_user_v1(uuid) TO service_role;
`;
write('supabase/migrations/20260819013500_granular_config_permissions_and_dashboard.sql', migration);

const test = `import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canAccessConfigSection,
  canOpenPortalConfig,
  getFirstVisibleConfigSection,
  getVisibleConfigNavigationItems,
} from '../../src/features/permissions/configPermissions';

const nav = [
  { key: 'users', sub: [{ key: 'users_list' }, { key: 'org_structure' }] },
  { key: 'audit', sub: [{ key: 'audit_log' }] },
];

test('config entry requires config_view for non-admin users', () => {
  assert.equal(canOpenPortalConfig(false, { 'config_users.users_list': true }), false);
  assert.equal(canOpenPortalConfig(false, { config_view: true }), true);
  assert.equal(canOpenPortalConfig(true, undefined), true);
  assert.equal(canOpenPortalConfig(false, null), true);
});

test('each config section uses its dedicated permission', () => {
  const permissions = { config_view: true, 'config_users.users_list': true };
  assert.equal(canAccessConfigSection('users_list', false, permissions), true);
  assert.equal(canAccessConfigSection('org_structure', false, permissions), false);
});

test('configuration navigation hides inaccessible groups and sections', () => {
  const visible = getVisibleConfigNavigationItems(nav, false, {
    config_view: true,
    'config_users.org_structure': true,
  });
  assert.deepEqual(visible, [{ key: 'users', sub: [{ key: 'org_structure' }] }]);
  assert.equal(getFirstVisibleConfigSection(visible), 'org_structure');
});

test('full access sees all configuration sections', () => {
  assert.deepEqual(getVisibleConfigNavigationItems(nav, false, null), nav);
});
`;
write('tests/app/configPermissions.test.ts', test);

console.log('Temporary transformer completed. Source changes are uncommitted until validation passes.');
