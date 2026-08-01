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
      className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700/60 rounded-xl transition-colors"
      aria-label={label}
    >
      <ChevronRight className="w-4 h-4" />
      <span>{label}</span>
    </button>
  );
}
