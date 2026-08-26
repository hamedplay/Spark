import { Loader as Loader2, CircleCheck as CheckCircle, TriangleAlert as AlertTriangle, Database } from 'lucide-react';
import type { TableConfig } from './tablesConfig';
import { TABLE_ICON, TABLE_COLOR, TABLE_LABEL } from './tablesConfig';

export function TableRow({ cfg, selected, onToggle, status }: {
  cfg: TableConfig;
  selected: boolean;
  onToggle: () => void;
  status: 'idle' | 'loading' | 'done' | 'error';
}) {
  const Icon = cfg.icon;
  return (
    <div
      onClick={onToggle}
      className={`flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-all border ${selected ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-700' : 'bg-white dark:bg-gray-800 border-gray-100 dark:border-gray-700 hover:border-gray-200 dark:hover:border-gray-600'}`}
    >
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${selected ? 'bg-blue-100 dark:bg-blue-900/40' : 'bg-gray-100 dark:bg-gray-700'}`}>
        <Icon className={`w-4 h-4 ${selected ? 'text-blue-500' : cfg.color}`} />
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium ${selected ? 'text-blue-700 dark:text-blue-300' : 'text-gray-800 dark:text-white'}`}>{cfg.label}</p>
        <p className="text-xs text-gray-400 dark:text-gray-500 truncate">{cfg.description}</p>
      </div>
      <div className="flex-shrink-0">
        {status === 'loading' && <Loader2 className="w-4 h-4 animate-spin text-blue-400" />}
        {status === 'done' && <CheckCircle className="w-4 h-4 text-green-500" />}
        {status === 'error' && <AlertTriangle className="w-4 h-4 text-red-400" />}
        {status === 'idle' && (
          <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${selected ? 'border-blue-500 bg-blue-500' : 'border-gray-300 dark:border-gray-600'}`}>
            {selected && <div className="w-2 h-2 rounded-full bg-white" />}
          </div>
        )}
      </div>
    </div>
  );
}

export function RestoreTableRow({ tableKey, rowCount, selected, onToggle, status }: {
  tableKey: string;
  rowCount: number;
  selected: boolean;
  onToggle: () => void;
  status: 'idle' | 'loading' | 'done' | 'error';
}) {
  const Icon = TABLE_ICON[tableKey] ?? Database;
  const color = TABLE_COLOR[tableKey] ?? 'text-gray-400';
  const label = TABLE_LABEL[tableKey] ?? tableKey;

  return (
    <div
      onClick={onToggle}
      className={`flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-all border ${selected ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-700' : 'bg-white dark:bg-gray-800 border-gray-100 dark:border-gray-700 hover:border-gray-200 dark:hover:border-gray-600'}`}
    >
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${selected ? 'bg-emerald-100 dark:bg-emerald-900/40' : 'bg-gray-100 dark:bg-gray-700'}`}>
        <Icon className={`w-4 h-4 ${selected ? 'text-emerald-600' : color}`} />
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium ${selected ? 'text-emerald-700 dark:text-emerald-300' : 'text-gray-800 dark:text-white'}`}>{label}</p>
        <p className="text-xs text-gray-400 dark:text-gray-500">{rowCount.toLocaleString('fa-IR')} ردیف</p>
      </div>
      <div className="flex-shrink-0">
        {status === 'loading' && <Loader2 className="w-4 h-4 animate-spin text-emerald-500" />}
        {status === 'done' && <CheckCircle className="w-4 h-4 text-green-500" />}
        {status === 'error' && <AlertTriangle className="w-4 h-4 text-red-400" />}
        {status === 'idle' && (
          <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${selected ? 'border-emerald-500 bg-emerald-500' : 'border-gray-300 dark:border-gray-600'}`}>
            {selected && <div className="w-2 h-2 rounded-full bg-white" />}
          </div>
        )}
      </div>
    </div>
  );
}
