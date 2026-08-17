import { ChevronRight } from 'lucide-react';
import type { PageId } from '../../app/navigation/useNavigation';

interface Props {
  onNavigate?: (page: PageId) => void;
  target?: PageId;
  label: string;
  onClick?: () => void;
}

export function MinutesBackButton({ onNavigate, target, label, onClick }: Props) {
  return (
    <button
      onClick={() => {
        if (onClick) {
          onClick();
        } else if (onNavigate && target) {
          onNavigate(target);
        }
      }}
      className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 text-[11px] font-bold text-slate-600 shadow-[0_4px_14px_rgba(15,23,42,0.03)] transition hover:border-violet-200 hover:bg-violet-50 hover:text-violet-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-violet-500/30 dark:hover:bg-violet-500/10 dark:hover:text-violet-300"
      aria-label={label}
    >
      <ChevronRight className="h-3.5 w-3.5" />
      <span>{label}</span>
    </button>
  );
}
