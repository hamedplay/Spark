from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace(path: str, old: str, new: str, expected: int = 1) -> None:
    file_path = ROOT / path
    text = file_path.read_text(encoding="utf-8")
    actual = text.count(old)
    if actual != expected:
        raise RuntimeError(f"{path}: expected {expected} occurrence(s), found {actual}: {old[:120]!r}")
    file_path.write_text(text.replace(old, new), encoding="utf-8")


# 1) Dedicated dashboard-access resolution: do not infer from Admin/full-access.
replace(
    "src/AuthenticatedApp.tsx",
    """  const canOpenConfig = canOpenPortalConfig(isAdmin, userPermissions);\n  useAdminPathGuard(true, canOpenConfig, navigate);\n\n  const [showSplash, setShowSplash] = useState(false);\n""",
    """  const canOpenConfig = canOpenPortalConfig(isAdmin, userPermissions);\n  useAdminPathGuard(true, canOpenConfig, navigate);\n\n  const [managementDashboardAllowed, setManagementDashboardAllowed] = useState(false);\n  const [managementDashboardAccessLoading, setManagementDashboardAccessLoading] = useState(true);\n  useEffect(() => {\n    let cancelled = false;\n\n    if (!currentUserId) {\n      setManagementDashboardAllowed(false);\n      setManagementDashboardAccessLoading(false);\n      return () => { cancelled = true; };\n    }\n\n    setManagementDashboardAccessLoading(true);\n    void (async () => {\n      const { data, error } = await supabase.rpc('has_management_dashboard_access_v1');\n      if (cancelled) return;\n      setManagementDashboardAllowed(!error && data === true);\n      setManagementDashboardAccessLoading(false);\n    })();\n\n    return () => { cancelled = true; };\n  }, [currentUserId]);\n\n  const [showSplash, setShowSplash] = useState(false);\n""",
)
replace(
    "src/AuthenticatedApp.tsx",
    """    sparkVisible,\n    minutesFollowupAllowed: minutesFollowupAccess.allowed,\n    minutesFollowupAccessLoading: minutesFollowupAccess.loading,\n""",
    """    sparkVisible,\n    managementDashboardAllowed,\n    managementDashboardAccessLoading,\n    minutesFollowupAllowed: minutesFollowupAccess.allowed,\n    minutesFollowupAccessLoading: minutesFollowupAccess.loading,\n""",
)

replace(
    "src/app/navigation/pageRendererTypes.ts",
    """  sparkVisible: boolean;\n  minutesFollowupAllowed: boolean;\n""",
    """  sparkVisible: boolean;\n  managementDashboardAllowed: boolean;\n  managementDashboardAccessLoading: boolean;\n  minutesFollowupAllowed: boolean;\n""",
)

replace(
    "src/app/navigation/PageRenderer.tsx",
    """    sparkVisible,\n    minutesFollowupAllowed,\n    minutesFollowupAccessLoading,\n""",
    """    sparkVisible,\n    managementDashboardAllowed,\n    managementDashboardAccessLoading,\n    minutesFollowupAllowed,\n    minutesFollowupAccessLoading,\n""",
)
replace(
    "src/app/navigation/PageRenderer.tsx",
    """  const permKey = PAGE_PERMISSION_KEY[activePage];\n  if (permKey && !checkPermission(permKey, isAdmin, userPermissions)) {\n    return <AccessDenied onReturn={() => navigate('profile')} />;\n  }\n\n  switch (activePage) {\n    case 'management-dashboard':\n      return <ManagementDashboardPage />;\n""",
    """  if (activePage === 'management-dashboard') {\n    if (managementDashboardAccessLoading) {\n      return (\n        <div className=\"flex items-center justify-center min-h-[60vh]\">\n          <div className=\"animate-spin rounded-full h-10 w-10 border-b-2 border-violet-500\" />\n          <span className=\"mr-3 text-sm text-slate-500 dark:text-slate-400\">در حال بررسی دسترسی...</span>\n        </div>\n      );\n    }\n    if (!managementDashboardAllowed) {\n      return <AccessDenied onReturn={() => navigate('profile')} />;\n    }\n  }\n\n  const permKey = activePage === 'management-dashboard' ? undefined : PAGE_PERMISSION_KEY[activePage];\n  if (permKey && !checkPermission(permKey, isAdmin, userPermissions)) {\n    return <AccessDenied onReturn={() => navigate('profile')} />;\n  }\n\n  switch (activePage) {\n    case 'management-dashboard':\n      return <ManagementDashboardPage onNavigate={navigate} />;\n""",
)

# Menu visibility uses the same dedicated authorization result as the route.
replace(
    "src/app/layout/AppShell.tsx",
    """          isAdmin={isAdmin}\n          userPermissions={userPermissions}\n          sparkVisible={sparkVisible}\n""",
    """          isAdmin={isAdmin}\n          userPermissions={userPermissions}\n          managementDashboardAllowed={rendererProps.managementDashboardAllowed}\n          sparkVisible={sparkVisible}\n""",
)
replace(
    "src/components/Layout.tsx",
    """  userPermissions?: LayoutUserPermissions;\n  minutesFollowupAllowed?: boolean;\n""",
    """  userPermissions?: LayoutUserPermissions;\n  managementDashboardAllowed?: boolean;\n  minutesFollowupAllowed?: boolean;\n""",
)
replace(
    "src/components/Layout.tsx",
    """  userPermissions,\n  sparkVisible = false,\n""",
    """  userPermissions,\n  managementDashboardAllowed = false,\n  sparkVisible = false,\n""",
)
replace(
    "src/components/Layout.tsx",
    """        userPermissions={userPermissions ?? null}\n        minutesFollowupAllowed={minutesFollowupAllowed}\n""",
    """        userPermissions={userPermissions ?? null}\n        managementDashboardAllowed={managementDashboardAllowed}\n        minutesFollowupAllowed={minutesFollowupAllowed}\n""",
)
replace(
    "src/app/layout/components/LayoutSidebar.tsx",
    """  userPermissions: LayoutUserPermissions;\n  minutesFollowupAllowed: boolean;\n""",
    """  userPermissions: LayoutUserPermissions;\n  managementDashboardAllowed: boolean;\n  minutesFollowupAllowed: boolean;\n""",
)
replace(
    "src/app/layout/components/LayoutSidebar.tsx",
    """  userPermissions,\n  minutesFollowupAllowed,\n""",
    """  userPermissions,\n  managementDashboardAllowed,\n  minutesFollowupAllowed,\n""",
)
replace(
    "src/app/layout/components/LayoutSidebar.tsx",
    """  const menuItems = getVisiblePrimaryNavigationItems({\n    isAdmin,\n    sparkVisible: !!sparkVisible,\n    userPermissions,\n  }).map((item) => ({\n""",
    """  const menuItems = getVisiblePrimaryNavigationItems({\n    isAdmin,\n    sparkVisible: !!sparkVisible,\n    userPermissions,\n    managementDashboardAllowed,\n  }).map((item) => ({\n""",
)
replace(
    "src/app/layout/navigationMenu.ts",
    """export function getVisiblePrimaryNavigationItems(\n  context: Pick<NavigationVisibilityContext, 'isAdmin' | 'sparkVisible' | 'userPermissions'>\n): LayoutNavigationItem[] {\n  return PRIMARY_NAVIGATION_ITEMS.filter(item => {\n    if (item.requiresSparkVisible && !context.sparkVisible) return false;\n    if (context.isAdmin) return true;\n""",
    """export function getVisiblePrimaryNavigationItems(\n  context: Pick<NavigationVisibilityContext, 'isAdmin' | 'sparkVisible' | 'userPermissions'> & { managementDashboardAllowed: boolean }\n): LayoutNavigationItem[] {\n  return PRIMARY_NAVIGATION_ITEMS.filter(item => {\n    if (item.requiresSparkVisible && !context.sparkVisible) return false;\n    if (item.id === 'management-dashboard') return context.managementDashboardAllowed;\n    if (context.isAdmin) return true;\n""",
)

# Update focused navigation tests to prove Admin/null no longer bypass the dedicated dashboard gate.
replace(
    "tests/app/layoutNavigation.test.ts",
    """    userPermissions: null,\n    minutesFollowupAllowed: true,\n""",
    """    userPermissions: null,\n    managementDashboardAllowed: true,\n    minutesFollowupAllowed: true,\n""",
    expected=1,
)
replace(
    "tests/app/layoutNavigation.test.ts",
    """    isAdmin: true,\n    sparkVisible: false,\n    userPermissions: null,\n    minutesFollowupAllowed: true,\n""",
    """    isAdmin: true,\n    sparkVisible: false,\n    userPermissions: null,\n    managementDashboardAllowed: true,\n    minutesFollowupAllowed: true,\n""",
)
replace(
    "tests/app/layoutNavigation.test.ts",
    """    isAdmin: false,\n    sparkVisible: true,\n    userPermissions: { spark: true },\n    minutesFollowupAllowed: false,\n""",
    """    isAdmin: false,\n    sparkVisible: true,\n    userPermissions: { spark: true },\n    managementDashboardAllowed: false,\n    minutesFollowupAllowed: false,\n""",
)
replace(
    "tests/app/layoutNavigation.test.ts",
    """test('shows management dashboard only when its dedicated permission is granted', () => {\n  const allowed = getVisiblePrimaryNavigationItems({\n    isAdmin: false,\n    sparkVisible: true,\n    userPermissions: { management_dashboard: true },\n  });\n  const denied = getVisiblePrimaryNavigationItems({\n    isAdmin: false,\n    sparkVisible: true,\n    userPermissions: { management_dashboard: false, meetings: true },\n  });\n\n  assert.ok(allowed.some(i => i.id === 'management-dashboard'));\n  assert.ok(!denied.some(i => i.id === 'management-dashboard'));\n});\n\ntest('allows administrators to see all non-Spark-hidden items', () => {\n  const items = getVisiblePrimaryNavigationItems({\n    isAdmin: true,\n    sparkVisible: true,\n    userPermissions: undefined,\n    minutesFollowupAllowed: true,\n    minutesFollowupAccessLoading: false,\n  });\n\n  assert.equal(items.length, 12);\n});\n\ntest('treats null permissions as full access', () => {\n  const items = getVisiblePrimaryNavigationItems({\n    isAdmin: false,\n    sparkVisible: true,\n    userPermissions: null,\n    minutesFollowupAllowed: true,\n    minutesFollowupAccessLoading: false,\n  });\n\n  assert.equal(items.length, 12);\n});\n""",
    """test('shows management dashboard only when its dedicated access result is granted', () => {\n  const allowed = getVisiblePrimaryNavigationItems({\n    isAdmin: false,\n    sparkVisible: true,\n    userPermissions: {},\n    managementDashboardAllowed: true,\n  });\n  const denied = getVisiblePrimaryNavigationItems({\n    isAdmin: true,\n    sparkVisible: true,\n    userPermissions: null,\n    managementDashboardAllowed: false,\n  });\n\n  assert.ok(allowed.some(i => i.id === 'management-dashboard'));\n  assert.ok(!denied.some(i => i.id === 'management-dashboard'));\n});\n\ntest('administrator access does not bypass the dedicated management dashboard gate', () => {\n  const items = getVisiblePrimaryNavigationItems({\n    isAdmin: true,\n    sparkVisible: true,\n    userPermissions: undefined,\n    managementDashboardAllowed: false,\n  });\n\n  assert.equal(items.length, 11);\n  assert.ok(!items.some(i => i.id === 'management-dashboard'));\n});\n\ntest('null permissions remain full access except for the dedicated management dashboard gate', () => {\n  const items = getVisiblePrimaryNavigationItems({\n    isAdmin: false,\n    sparkVisible: true,\n    userPermissions: null,\n    managementDashboardAllowed: false,\n  });\n\n  assert.equal(items.length, 11);\n  assert.ok(!items.some(i => i.id === 'management-dashboard'));\n});\n""",
)
replace(
    "tests/app/layoutNavigation.test.ts",
    """    userPermissions: undefined,\n    minutesFollowupAllowed: false,\n    minutesFollowupAccessLoading: true,\n""",
    """    userPermissions: undefined,\n    managementDashboardAllowed: false,\n    minutesFollowupAllowed: false,\n    minutesFollowupAccessLoading: true,\n""",
)
replace(
    "tests/app/layoutNavigation.test.ts",
    """      reports: true,\n    },\n    minutesFollowupAllowed: false,\n""",
    """      reports: true,\n    },\n    managementDashboardAllowed: true,\n    minutesFollowupAllowed: false,\n""",
)

# 2) Management dashboard drill-down wiring.
replace(
    "src/components/ManagementDashboardPage.tsx",
    """import { supabase } from '../lib/supabase';\n""",
    """import { supabase } from '../lib/supabase';\nimport type { PageId } from '../app/navigation/useNavigation';\n""",
)
replace(
    "src/components/ManagementDashboardPage.tsx",
    """interface DeadlineAlertItem {\n  id: string;\n  source: 'task' | 'decision';\n  title: string;\n  due_date: string;\n  days_remaining: number;\n  priority: string;\n}\n""",
    """interface DeadlineAlertItem {\n  id: string;\n  source: 'task' | 'decision';\n  title: string;\n  due_date: string;\n  days_remaining: number;\n  priority: string;\n  minute_id?: string | null;\n}\n""",
)
replace(
    "src/components/ManagementDashboardPage.tsx",
    """function KpiCard({\n  title,\n  value,\n  sub,\n  icon: Icon,\n  tone,\n}: {\n  title: string;\n  value: number | string;\n  sub: string;\n  icon: React.ElementType;\n  tone: Tone;\n}) {\n  const styles = toneClasses[tone];\n  return (\n    <div className={`min-w-0 rounded-2xl border p-3.5 shadow-[0_12px_40px_rgba(0,0,0,0.12)] ${styles.card}`}>\n      <div className=\"flex items-start justify-between gap-2\">\n        <div className=\"min-w-0\">\n          <p className=\"truncate text-[11px] font-medium text-slate-400\">{title}</p>\n          <p className=\"mt-2 text-2xl font-black tracking-tight text-white\">{typeof value === 'number' ? nf.format(value) : value}</p>\n        </div>\n        <div className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl ring-1 ${styles.icon}`}>\n          <Icon className=\"h-[18px] w-[18px]\" />\n        </div>\n      </div>\n      <p className={`mt-2 truncate text-[10px] ${styles.accent}`}>{sub}</p>\n    </div>\n  );\n}\n""",
    """function KpiCard({\n  title,\n  value,\n  sub,\n  icon: Icon,\n  tone,\n  onClick,\n}: {\n  title: string;\n  value: number | string;\n  sub: string;\n  icon: React.ElementType;\n  tone: Tone;\n  onClick?: () => void;\n}) {\n  const styles = toneClasses[tone];\n  const content = (\n    <>\n      <div className=\"flex items-start justify-between gap-2\">\n        <div className=\"min-w-0\">\n          <p className=\"truncate text-[11px] font-medium text-slate-400\">{title}</p>\n          <p className=\"mt-2 text-2xl font-black tracking-tight text-white\">{typeof value === 'number' ? nf.format(value) : value}</p>\n        </div>\n        <div className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl ring-1 ${styles.icon}`}>\n          <Icon className=\"h-[18px] w-[18px]\" />\n        </div>\n      </div>\n      <p className={`mt-2 truncate text-[10px] ${styles.accent}`}>{sub}</p>\n    </>\n  );\n\n  if (!onClick) {\n    return <div className={`min-w-0 rounded-2xl border p-3.5 shadow-[0_12px_40px_rgba(0,0,0,0.12)] ${styles.card}`}>{content}</div>;\n  }\n\n  return (\n    <button\n      type=\"button\"\n      onClick={onClick}\n      className={`min-w-0 rounded-2xl border p-3.5 text-right shadow-[0_12px_40px_rgba(0,0,0,0.12)] transition hover:-translate-y-0.5 hover:border-slate-500/50 focus:outline-none focus:ring-2 focus:ring-violet-400/50 ${styles.card}`}\n    >\n      {content}\n    </button>\n  );\n}\n""",
)
replace(
    "src/components/ManagementDashboardPage.tsx",
    """export function ManagementDashboardPage() {\n  const [data, setData] = useState<ManagementDashboardData | null>(null);\n""",
    """export function ManagementDashboardPage({ onNavigate }: { onNavigate: (page: PageId) => void }) {\n  const [data, setData] = useState<ManagementDashboardData | null>(null);\n""",
)
replace(
    "src/components/ManagementDashboardPage.tsx",
    """  const insights = useMemo(() => {\n""",
    """  const navigateWithParams = useCallback((page: PageId, params: Record<string, string>) => {\n    const url = new URL(window.location.href);\n    ['task', 'taskView', 'meetingFocus', 'meetingView', 'decision'].forEach((key) => url.searchParams.delete(key));\n    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));\n    window.history.replaceState({}, '', url.toString());\n    onNavigate(page);\n  }, [onNavigate]);\n\n  const openTask = useCallback((taskId: string) => {\n    navigateWithParams('tasks', { task: taskId });\n  }, [navigateWithParams]);\n\n  const openTaskView = useCallback((view: string) => {\n    navigateWithParams('tasks', { taskView: view });\n  }, [navigateWithParams]);\n\n  const openMeeting = useCallback((meetingId: string) => {\n    navigateWithParams('meetings', { meetingFocus: meetingId });\n  }, [navigateWithParams]);\n\n  const openDecision = useCallback((alert: DeadlineAlertItem) => {\n    if (!alert.minute_id) {\n      toast.error('صورت‌جلسه مرتبط با این مصوبه مشخص نیست');\n      return;\n    }\n    navigateWithParams('minutes-detail', {\n      minute: alert.minute_id,\n      mtab: 'decisions',\n      decision: alert.id,\n    });\n  }, [navigateWithParams]);\n\n  const insights = useMemo(() => {\n""",
)
replace(
    "src/components/ManagementDashboardPage.tsx",
    """  const kpis = [\n    { title: 'کل تسک‌ها', value: stats.total_tasks, sub: 'همه تسک‌های غیرآرشیوی', icon: ListTodo, tone: 'blue' as Tone },\n    { title: 'تسک‌های امروز', value: stats.today_tasks, sub: 'سررسید امروز', icon: CalendarDays, tone: 'violet' as Tone },\n    { title: 'در حال انجام', value: stats.in_progress_tasks, sub: 'نیازمند ادامه کار', icon: Activity, tone: 'cyan' as Tone },\n    { title: 'تکمیل‌شده', value: stats.completed_tasks, sub: 'تسک‌های بسته‌شده', icon: CheckCircle2, tone: 'green' as Tone },\n    { title: 'عقب‌مانده', value: stats.overdue_tasks, sub: 'عبور کرده از مهلت', icon: Clock3, tone: 'rose' as Tone },\n    { title: 'تسک‌های فوری', value: stats.urgent_tasks, sub: 'اولویت بالا و باز', icon: Zap, tone: 'amber' as Tone },\n    { title: 'جلسات فعال', value: stats.active_meetings, sub: `از ${nf.format(stats.total_meetings)} جلسه ثبت‌شده`, icon: BriefcaseBusiness, tone: 'teal' as Tone },\n  ];\n""",
    """  const kpis = [\n    { title: 'کل تسک‌ها', value: stats.total_tasks, sub: 'همه تسک‌های غیرآرشیوی', icon: ListTodo, tone: 'blue' as Tone, onClick: () => openTaskView('all') },\n    { title: 'تسک‌های امروز', value: stats.today_tasks, sub: 'سررسید امروز', icon: CalendarDays, tone: 'violet' as Tone, onClick: () => openTaskView('today') },\n    { title: 'در حال انجام', value: stats.in_progress_tasks, sub: 'نیازمند ادامه کار', icon: Activity, tone: 'cyan' as Tone, onClick: () => openTaskView('in_progress') },\n    { title: 'تکمیل‌شده', value: stats.completed_tasks, sub: 'تسک‌های بسته‌شده', icon: CheckCircle2, tone: 'green' as Tone, onClick: () => openTaskView('completed') },\n    { title: 'عقب‌مانده', value: stats.overdue_tasks, sub: 'عبور کرده از مهلت', icon: Clock3, tone: 'rose' as Tone, onClick: () => openTaskView('overdue') },\n    { title: 'تسک‌های فوری', value: stats.urgent_tasks, sub: 'اولویت بالا و باز', icon: Zap, tone: 'amber' as Tone, onClick: () => openTaskView('urgent') },\n    { title: 'جلسات فعال', value: stats.active_meetings, sub: `از ${nf.format(stats.total_meetings)} جلسه ثبت‌شده`, icon: BriefcaseBusiness, tone: 'teal' as Tone, onClick: () => navigateWithParams('meetings', { meetingView: 'open' }) },\n  ];\n""",
)
replace(
    "src/components/ManagementDashboardPage.tsx",
    """                  <div key={meeting.id} className=\"rounded-xl border border-slate-800/80 bg-slate-900/35 p-3\">\n""",
    """                  <button type=\"button\" onClick={() => openMeeting(meeting.id)} key={meeting.id} className=\"w-full rounded-xl border border-slate-800/80 bg-slate-900/35 p-3 text-right transition hover:border-cyan-500/30 hover:bg-slate-900/60 focus:outline-none focus:ring-2 focus:ring-cyan-400/40\">\n""",
)
replace(
    "src/components/ManagementDashboardPage.tsx",
    """                  </div>\n                ))}\n              </div>\n            ) : <EmptyState text=\"جلسه‌ای ثبت نشده است\" />}\n""",
    """                  </button>\n                ))}\n              </div>\n            ) : <EmptyState text=\"جلسه‌ای ثبت نشده است\" />}\n""",
)
replace(
    "src/components/ManagementDashboardPage.tsx",
    """                    <div key={task.id} className=\"rounded-xl border border-slate-800/80 bg-slate-900/35 px-3 py-2.5\">\n""",
    """                    <button type=\"button\" onClick={() => openTask(task.id)} key={task.id} className=\"w-full rounded-xl border border-slate-800/80 bg-slate-900/35 px-3 py-2.5 text-right transition hover:border-violet-500/30 hover:bg-slate-900/60 focus:outline-none focus:ring-2 focus:ring-violet-400/40\">\n""",
)
replace(
    "src/components/ManagementDashboardPage.tsx",
    """                    </div>\n                  );\n                })}\n              </div>\n            ) : <EmptyState text=\"تسک مهم یا معوقی وجود ندارد\" />}\n""",
    """                    </button>\n                  );\n                })}\n              </div>\n            ) : <EmptyState text=\"تسک مهم یا معوقی وجود ندارد\" />}\n""",
)
replace(
    "src/components/ManagementDashboardPage.tsx",
    """                  <div key={item.id} className=\"relative pb-4 last:pb-0\">\n""",
    """                  <button type=\"button\" onClick={() => openMeeting(item.id)} key={item.id} className=\"relative block w-full pb-4 text-right last:pb-0 focus:outline-none\">\n""",
)
replace(
    "src/components/ManagementDashboardPage.tsx",
    """                  </div>\n                ))}\n              </div>\n            ) : <EmptyState text=\"برای امروز جلسه‌ای در تقویم نیست\" />}\n""",
    """                  </button>\n                ))}\n              </div>\n            ) : <EmptyState text=\"برای امروز جلسه‌ای در تقویم نیست\" />}\n""",
)
replace(
    "src/components/ManagementDashboardPage.tsx",
    """                    <div key={`${alert.source}-${alert.id}`} className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 ${overdue ? 'border-rose-500/20 bg-rose-500/[0.06]' : 'border-slate-800/80 bg-slate-900/35'}`}>\n""",
    """                    <button type=\"button\" onClick={() => alert.source === 'decision' ? openDecision(alert) : openTask(alert.id)} key={`${alert.source}-${alert.id}`} className={`flex w-full items-center gap-2 rounded-xl border px-3 py-2.5 text-right transition hover:border-violet-500/30 focus:outline-none focus:ring-2 focus:ring-violet-400/40 ${overdue ? 'border-rose-500/20 bg-rose-500/[0.06]' : 'border-slate-800/80 bg-slate-900/35'}`}>\n""",
)
replace(
    "src/components/ManagementDashboardPage.tsx",
    """                    </div>\n                  );\n                })}\n              </div>\n            ) : <EmptyState text=\"هشدار مهلت فعالی وجود ندارد\" />}\n""",
    """                    </button>\n                  );\n                })}\n              </div>\n            ) : <EmptyState text=\"هشدار مهلت فعالی وجود ندارد\" />}\n""",
)
replace(
    "src/components/ManagementDashboardPage.tsx",
    """            <div className=\"rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.06] p-3 text-center\">\n              <UsersRound className=\"mx-auto h-5 w-5 text-emerald-300\" />\n              <p className=\"mt-2 text-xl font-black text-white\">{nf.format(stats.total_decisions)}</p>\n              <p className=\"mt-1 text-[9px] text-slate-500\">کل مصوبات</p>\n            </div>\n            <div className=\"rounded-2xl border border-amber-500/20 bg-amber-500/[0.06] p-3 text-center\">\n              <Gauge className=\"mx-auto h-5 w-5 text-amber-300\" />\n              <p className=\"mt-2 text-xl font-black text-white\">{nf.format(stats.completion_rate)}٪</p>\n              <p className=\"mt-1 text-[9px] text-slate-500\">تکمیل به‌موقع</p>\n            </div>\n            <div className=\"col-span-2 rounded-2xl border border-blue-500/20 bg-blue-500/[0.06] p-3 text-center sm:col-span-1\">\n              <TrendingUp className=\"mx-auto h-5 w-5 text-blue-300\" />\n              <p className=\"mt-2 text-xl font-black text-white\">{nf.format(stats.active_meetings)}</p>\n              <p className=\"mt-1 text-[9px] text-slate-500\">جلسات فعال</p>\n            </div>\n""",
    """            <button type=\"button\" onClick={() => onNavigate('minutes-hub')} className=\"rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.06] p-3 text-center transition hover:border-emerald-400/40 focus:outline-none focus:ring-2 focus:ring-emerald-400/40\">\n              <UsersRound className=\"mx-auto h-5 w-5 text-emerald-300\" />\n              <p className=\"mt-2 text-xl font-black text-white\">{nf.format(stats.total_decisions)}</p>\n              <p className=\"mt-1 text-[9px] text-slate-500\">کل مصوبات</p>\n            </button>\n            <button type=\"button\" onClick={() => openTaskView('completed')} className=\"rounded-2xl border border-amber-500/20 bg-amber-500/[0.06] p-3 text-center transition hover:border-amber-400/40 focus:outline-none focus:ring-2 focus:ring-amber-400/40\">\n              <Gauge className=\"mx-auto h-5 w-5 text-amber-300\" />\n              <p className=\"mt-2 text-xl font-black text-white\">{nf.format(stats.completion_rate)}٪</p>\n              <p className=\"mt-1 text-[9px] text-slate-500\">تکمیل به‌موقع</p>\n            </button>\n            <button type=\"button\" onClick={() => navigateWithParams('meetings', { meetingView: 'open' })} className=\"col-span-2 rounded-2xl border border-blue-500/20 bg-blue-500/[0.06] p-3 text-center transition hover:border-blue-400/40 focus:outline-none focus:ring-2 focus:ring-blue-400/40 sm:col-span-1\">\n              <TrendingUp className=\"mx-auto h-5 w-5 text-blue-300\" />\n              <p className=\"mt-2 text-xl font-black text-white\">{nf.format(stats.active_meetings)}</p>\n              <p className=\"mt-1 text-[9px] text-slate-500\">جلسات فعال</p>\n            </button>\n""",
)

# 3) Task target page: consume exact task / dashboard view parameters and show the requested subject.
replace(
    "src/components/TasksPage.tsx",
    """import { DeleteTaskModal } from './Tasks/DeleteTaskModal';\n\nexport function TasksPage""",
    """import { DeleteTaskModal } from './Tasks/DeleteTaskModal';\n\ntype DashboardTaskView = 'all' | 'today' | 'in_progress' | 'completed' | 'overdue' | 'urgent';\nconst DASHBOARD_TASK_VIEWS = new Set<DashboardTaskView>(['all', 'today', 'in_progress', 'completed', 'overdue', 'urgent']);\nconst tehranDayFormatter = new Intl.DateTimeFormat('en-US', {\n  timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit',\n});\n\nfunction tehranDayKey(date: Date): string | null {\n  if (Number.isNaN(date.getTime())) return null;\n  const parts = tehranDayFormatter.formatToParts(date);\n  const year = parts.find(p => p.type === 'year')?.value;\n  const month = parts.find(p => p.type === 'month')?.value;\n  const day = parts.find(p => p.type === 'day')?.value;\n  return year && month && day ? `${year}-${month}-${day}` : null;\n}\n\nexport function TasksPage""",
)
replace(
    "src/components/TasksPage.tsx",
    """  const [taskTab, setTaskTab] = useState<'assigned_to_me' | 'created_by_me' | 'all'>('assigned_to_me');\n  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);\n""",
    """  const [taskTab, setTaskTab] = useState<'assigned_to_me' | 'created_by_me' | 'all'>('assigned_to_me');\n  const [focusTaskId, setFocusTaskId] = useState<string | null>(() => new URL(window.location.href).searchParams.get('task'));\n  const [dashboardTaskView, setDashboardTaskView] = useState<DashboardTaskView | null>(() => {\n    const value = new URL(window.location.href).searchParams.get('taskView') as DashboardTaskView | null;\n    return value && DASHBOARD_TASK_VIEWS.has(value) ? value : null;\n  });\n  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);\n""",
)
replace(
    "src/components/TasksPage.tsx",
    """  useEffect(() => {\n    if (prefillDescription) {\n""",
    """  useEffect(() => {\n    if (!focusTaskId && !dashboardTaskView) return;\n    setTaskTab('all');\n    setSearchTerm('');\n    setStatusFilter('all');\n    const url = new URL(window.location.href);\n    url.searchParams.delete('task');\n    url.searchParams.delete('taskView');\n    window.history.replaceState({}, '', url.toString());\n    // The focus/filter stays in component state until the user explicitly clears it.\n    // eslint-disable-next-line react-hooks/exhaustive-deps\n  }, []);\n\n  useEffect(() => {\n    if (prefillDescription) {\n""",
)
replace(
    "src/components/TasksPage.tsx",
    """  const filteredTasks = tasks.filter(task => {\n    const matchesSearch =\n""",
    """  const dashboardTodayKey = tehranDayKey(new Date());\n  const filteredTasks = tasks.filter(task => {\n    if (focusTaskId) return task.id === focusTaskId;\n\n    if (dashboardTaskView) {\n      if (task.archived) return false;\n      const dueKey = task.due_date ? tehranDayKey(new Date(task.due_date)) : null;\n      switch (dashboardTaskView) {\n        case 'all': return true;\n        case 'today': return dueKey !== null && dueKey === dashboardTodayKey;\n        case 'in_progress': return task.status === 'in_progress';\n        case 'completed': return task.status === 'completed';\n        case 'overdue': return task.status !== 'completed' && dueKey !== null && dashboardTodayKey !== null && dueKey < dashboardTodayKey;\n        case 'urgent': return task.priority === 'high' && task.status !== 'completed';\n      }\n    }\n\n    const matchesSearch =\n""",
)
replace(
    "src/components/TasksPage.tsx",
    """          <section className=\"mb-3 rounded-xl border border-slate-200/80 bg-white/85 p-2.5 shadow-[0_8px_24px_rgba(15,23,42,0.035)] backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/70 sm:p-3\">\n""",
    """          {(focusTaskId || dashboardTaskView) && (\n            <div className=\"mb-3 flex items-center justify-between gap-3 rounded-xl border border-violet-200 bg-violet-50/80 px-3 py-2 text-[10px] text-violet-700 dark:border-violet-500/25 dark:bg-violet-500/10 dark:text-violet-300 sm:text-xs\">\n              <span>{focusTaskId ? 'اقدام انتخاب‌شده از داشبورد مدیریتی نمایش داده شده است.' : 'فیلتر داشبورد مدیریتی روی اقدامات فعال است.'}</span>\n              <button type=\"button\" onClick={() => { setFocusTaskId(null); setDashboardTaskView(null); }} className=\"flex-shrink-0 rounded-lg border border-violet-200 bg-white px-2.5 py-1 font-bold transition hover:bg-violet-100 dark:border-violet-500/25 dark:bg-slate-900/50 dark:hover:bg-violet-500/10\">نمایش همه اقدامات</button>\n            </div>\n          )}\n\n          <section className=\"mb-3 rounded-xl border border-slate-200/80 bg-white/85 p-2.5 shadow-[0_8px_24px_rgba(15,23,42,0.035)] backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/70 sm:p-3\">\n""",
)

# 4) Meeting target page: consume exact meeting / active-meetings view parameters.
replace(
    "src/features/meetings/pages/MeetingsPage.tsx",
    """import { useMemo, useState } from 'react';\n""",
    """import { useEffect, useMemo, useState } from 'react';\n""",
)
replace(
    "src/features/meetings/pages/MeetingsPage.tsx",
    """  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);\n\n  const filteredMeetings = meetings.filter(meeting => {\n""",
    """  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);\n  const [focusMeetingId, setFocusMeetingId] = useState<string | null>(() => new URL(window.location.href).searchParams.get('meetingFocus'));\n  const [dashboardMeetingView] = useState<string | null>(() => new URL(window.location.href).searchParams.get('meetingView'));\n\n  useEffect(() => {\n    if (!focusMeetingId && dashboardMeetingView !== 'open') return;\n    setSearchTerm('');\n    setPriorityFilter('all');\n    setStatusFilter(focusMeetingId ? 'all' : 'open');\n    const url = new URL(window.location.href);\n    url.searchParams.delete('meetingFocus');\n    url.searchParams.delete('meetingView');\n    window.history.replaceState({}, '', url.toString());\n    // eslint-disable-next-line react-hooks/exhaustive-deps\n  }, []);\n\n  const filteredMeetings = meetings.filter(meeting => {\n    if (focusMeetingId) return meeting.id === focusMeetingId;\n""",
)
replace(
    "src/features/meetings/pages/MeetingsPage.tsx",
    """          <MeetingsDashboard {...stats} />\n\n          <section className=\"mb-3 rounded-xl border border-slate-200/80 bg-white/85 p-2.5 shadow-[0_8px_24px_rgba(15,23,42,0.035)] backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/70 sm:p-3\">\n""",
    """          <MeetingsDashboard {...stats} />\n\n          {focusMeetingId && (\n            <div className=\"mb-3 flex items-center justify-between gap-3 rounded-xl border border-cyan-200 bg-cyan-50/80 px-3 py-2 text-[10px] text-cyan-700 dark:border-cyan-500/25 dark:bg-cyan-500/10 dark:text-cyan-300 sm:text-xs\">\n              <span>جلسه انتخاب‌شده از داشبورد مدیریتی نمایش داده شده است.</span>\n              <button type=\"button\" onClick={() => setFocusMeetingId(null)} className=\"flex-shrink-0 rounded-lg border border-cyan-200 bg-white px-2.5 py-1 font-bold transition hover:bg-cyan-100 dark:border-cyan-500/25 dark:bg-slate-900/50 dark:hover:bg-cyan-500/10\">نمایش همه جلسات</button>\n            </div>\n          )}\n\n          <section className=\"mb-3 rounded-xl border border-slate-200/80 bg-white/85 p-2.5 shadow-[0_8px_24px_rgba(15,23,42,0.035)] backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/70 sm:p-3\">\n""",
)

# 5) Decision target: land on decisions tab and visually focus the exact decision/clause.
replace(
    "src/components/Minutes/Detail/TabDecisions.tsx",
    """  const [progressDecision, setProgressDecision] = useState<DecisionRow | null>(null);\n  const [progressHistory, setProgressHistory] = useState<DecisionUpdateRow[]>([]);\n""",
    """  const [progressDecision, setProgressDecision] = useState<DecisionRow | null>(null);\n  const [progressHistory, setProgressHistory] = useState<DecisionUpdateRow[]>([]);\n  const [focusDecisionId] = useState<string | null>(() => new URL(window.location.href).searchParams.get('decision'));\n""",
)
replace(
    "src/components/Minutes/Detail/TabDecisions.tsx",
    """  useEffect(() => {\n    void fetchData();\n    // eslint-disable-next-line react-hooks/exhaustive-deps\n  }, [minuteId]);\n\n  const openProgressModal = async (dec: ViewDecisionRow) => {\n""",
    """  useEffect(() => {\n    void fetchData();\n    // eslint-disable-next-line react-hooks/exhaustive-deps\n  }, [minuteId]);\n\n  useEffect(() => {\n    if (loading || !focusDecisionId) return;\n    const frame = window.requestAnimationFrame(() => {\n      document.getElementById(`decision-${focusDecisionId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });\n      const url = new URL(window.location.href);\n      url.searchParams.delete('decision');\n      window.history.replaceState({}, '', url.toString());\n    });\n    return () => window.cancelAnimationFrame(frame);\n  }, [loading, focusDecisionId, decisions]);\n\n  const openProgressModal = async (dec: ViewDecisionRow) => {\n""",
)
replace(
    "src/components/Minutes/Detail/TabDecisions.tsx",
    """          <div key={parent.id} className=\"space-y-3 rounded-2xl border border-gray-100 bg-white p-4 dark:border-gray-700 dark:bg-gray-800\">\n""",
    """          <div id={`decision-${parent.id}`} key={parent.id} className={`space-y-3 rounded-2xl border bg-white p-4 transition dark:bg-gray-800 ${focusDecisionId === parent.id ? 'border-violet-400 ring-2 ring-violet-400/50 dark:border-violet-500' : 'border-gray-100 dark:border-gray-700'}`}>\n""",
)
replace(
    "src/components/Minutes/Detail/TabDecisions.tsx",
    """                {clauses.map(clause => <div key={clause.id}>{renderExecution(clause, true)}</div>)}\n""",
    """                {clauses.map(clause => <div id={`decision-${clause.id}`} key={clause.id} className={focusDecisionId === clause.id ? 'rounded-xl ring-2 ring-violet-400/50' : ''}>{renderExecution(clause, true)}</div>)}\n""",
)

# 6) New migration only: remove blanket employee grant, add dedicated access RPC,
# harden service bridge and close direct browser RPC execution.
migration_path = ROOT / "supabase/migrations/20260819171500_harden_management_dashboard_access.sql"
if migration_path.exists():
    raise RuntimeError(f"migration already exists: {migration_path}")
migration_path.write_text("""-- Harden management dashboard authorization and drill-down metadata.\n-- Existing migrations are intentionally not modified.\n\n-- The employee group is a broad default role and must not implicitly grant the\n-- sensitive management dashboard. Explicit group / position / level grants remain.\nUPDATE public.user_groups\nSET permissions = permissions - 'management_dashboard'\nWHERE name = 'employee'\n  AND permissions ? 'management_dashboard';\n\nCREATE OR REPLACE FUNCTION public.has_management_dashboard_access_v1()\nRETURNS boolean\nLANGUAGE plpgsql\nSTABLE\nSECURITY DEFINER\nSET search_path = ''\nAS $$\nDECLARE\n  v_user_id uuid := auth.uid();\nBEGIN\n  IF v_user_id IS NULL THEN\n    RETURN false;\n  END IF;\n  IF NOT private.is_current_session_fully_authorized() THEN\n    RETURN false;\n  END IF;\n  RETURN public._has_permission(v_user_id, 'management_dashboard');\nEND;\n$$;\nREVOKE ALL ON FUNCTION public.has_management_dashboard_access_v1() FROM PUBLIC, anon;\nGRANT EXECUTE ON FUNCTION public.has_management_dashboard_access_v1() TO authenticated, service_role;\n\nCREATE OR REPLACE FUNCTION public.get_management_dashboard_for_user_v1(p_user_id uuid)\nRETURNS jsonb\nLANGUAGE plpgsql\nSECURITY INVOKER\nSET search_path = ''\nAS $$\nDECLARE\n  v_result jsonb;\n  v_deadlines jsonb;\nBEGIN\n  IF p_user_id IS NULL THEN\n    RAISE EXCEPTION 'INVALID_USER_ID';\n  END IF;\n\n  -- This permission is intentionally independent of Admin/full-access shortcuts.\n  IF NOT public._has_permission(p_user_id, 'management_dashboard') THEN\n    RAISE EXCEPTION 'MANAGEMENT_DASHBOARD_FORBIDDEN' USING ERRCODE = '42501';\n  END IF;\n\n  PERFORM set_config('request.jwt.claim.sub', p_user_id::text, true);\n  v_result := public.get_management_dashboard_v1();\n\n  -- Preserve the existing dashboard contract and add minute_id only to decision\n  -- deadline items so the UI can open the exact decision in its minute.\n  SELECT COALESCE(\n    jsonb_agg(\n      CASE\n        WHEN COALESCE(e.item->>'source', '') = 'decision' AND d.minute_id IS NOT NULL\n          THEN e.item || jsonb_build_object('minute_id', d.minute_id)\n        ELSE e.item\n      END\n      ORDER BY e.ord\n    ),\n    '[]'::jsonb\n  )\n  INTO v_deadlines\n  FROM jsonb_array_elements(COALESCE(v_result->'deadline_alerts', '[]'::jsonb))\n       WITH ORDINALITY AS e(item, ord)\n  LEFT JOIN public.minutes_decisions d\n    ON COALESCE(e.item->>'source', '') = 'decision'\n   AND d.id::text = e.item->>'id';\n\n  RETURN jsonb_set(v_result, '{deadline_alerts}', v_deadlines, true);\nEND;\n$$;\n\n-- Sensitive aggregate functions are service-only. Browser roles must use the\n-- JWT-verified Edge Function, whose bridge now enforces the explicit permission.\nREVOKE ALL ON FUNCTION public.get_management_dashboard_v1() FROM PUBLIC, anon, authenticated;\nGRANT EXECUTE ON FUNCTION public.get_management_dashboard_v1() TO service_role;\nREVOKE ALL ON FUNCTION public.get_management_dashboard_for_user_v1(uuid) FROM PUBLIC, anon, authenticated;\nGRANT EXECUTE ON FUNCTION public.get_management_dashboard_for_user_v1(uuid) TO service_role;\n""", encoding="utf-8")

# Structural validation before dependency install/build.
checks = {
    "src/AuthenticatedApp.tsx": ["has_management_dashboard_access_v1", "managementDashboardAccessLoading"],
    "src/app/navigation/PageRenderer.tsx": ["managementDashboardAllowed", "<ManagementDashboardPage onNavigate={navigate} />"],
    "src/app/layout/navigationMenu.ts": ["item.id === 'management-dashboard'", "managementDashboardAllowed"],
    "src/components/ManagementDashboardPage.tsx": ["taskView", "meetingFocus", "openDecision(alert)", "minute_id?: string | null"],
    "src/components/TasksPage.tsx": ["focusTaskId", "dashboardTaskView", "نمایش همه اقدامات"],
    "src/features/meetings/pages/MeetingsPage.tsx": ["focusMeetingId", "meetingView", "نمایش همه جلسات"],
    "src/components/Minutes/Detail/TabDecisions.tsx": ["focusDecisionId", "scrollIntoView", "decision-${clause.id}"],
    "supabase/migrations/20260819171500_harden_management_dashboard_access.sql": ["permissions - 'management_dashboard'", "has_management_dashboard_access_v1", "REVOKE ALL ON FUNCTION public.get_management_dashboard_v1()", "minute_id"],
}
for path, needles in checks.items():
    text = (ROOT / path).read_text(encoding="utf-8")
    for needle in needles:
        if needle not in text:
            raise RuntimeError(f"{path}: missing structural check {needle!r}")

print("management dashboard patch applied and structurally validated")
