export function Field({ label, icon: Icon, children }: { label: string; icon: React.ElementType; children: React.ReactNode }) {
  return (
    <div className="profile-field min-w-0">
      <label className="mb-1.5 block text-[11px] font-bold text-slate-600 dark:text-slate-300">{label}</label>
      <div className="relative min-w-0" data-spark-field-icon="right">
        <div className="pointer-events-none absolute right-2.5 top-[18px] z-10 -translate-y-1/2 text-violet-400 dark:text-violet-300" aria-hidden="true">
          <Icon className="h-3.5 w-3.5" />
        </div>
        {children}
      </div>
    </div>
  );
}
