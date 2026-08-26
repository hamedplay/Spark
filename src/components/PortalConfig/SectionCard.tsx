export function SectionCard({ title, icon: Icon, color = 'blue', children }: { title: string; icon: React.ElementType; color?: string; children: React.ReactNode }) {
  const colors: Record<string, string> = {
    blue: 'border-blue-100 bg-blue-50 text-blue-600 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-300',
    green: 'border-emerald-100 bg-emerald-50 text-emerald-600 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300',
    amber: 'border-amber-100 bg-amber-50 text-amber-600 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300',
    red: 'border-rose-100 bg-rose-50 text-rose-600 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300',
    teal: 'border-cyan-100 bg-cyan-50 text-cyan-600 dark:border-cyan-500/20 dark:bg-cyan-500/10 dark:text-cyan-300',
    gray: 'border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300',
  };
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_7px_22px_rgba(15,23,42,0.035)] dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center gap-2 border-b border-slate-100 px-3.5 py-2.5 dark:border-slate-800">
        <div className={`flex h-7 w-7 items-center justify-center rounded-lg border ${colors[color] || colors.blue}`}>
          <Icon className="h-3.5 w-3.5" />
        </div>
        <h3 className="text-xs font-bold text-slate-800 dark:text-white">{title}</h3>
      </div>
      <div className="grid grid-cols-1 gap-3 p-3.5 md:grid-cols-2">{children}</div>
    </section>
  );
}
