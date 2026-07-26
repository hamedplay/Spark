import { X, SlidersHorizontal, Activity } from 'lucide-react';
import type { SidePanel } from '../types';

export function SidePanelHeader(props: {
  sidePanel: SidePanel;
  isMobile: boolean;
  setSidePanel: React.Dispatch<React.SetStateAction<SidePanel>>;
  togglePanel: (p: SidePanel) => void;
  sortedQueueLength: number;
  allowChat: boolean;
}) {
  const { sidePanel, isMobile, setSidePanel, togglePanel, sortedQueueLength, allowChat } = props;

  return (
    <div className="flex border-b border-gray-800 flex-shrink-0">
      {isMobile && (
        <div className="absolute -top-6 left-1/2 -translate-x-1/2 w-10 h-1.5 bg-gray-600 rounded-full" />
      )}
      {sidePanel === 'settings' ? (
        <>
          <div className="flex-1 flex items-center px-3 py-2.5 gap-2">
            <SlidersHorizontal className="w-4 h-4 text-teal-400 flex-shrink-0" />
            <span className="text-sm font-medium text-teal-400">تنظیمات</span>
          </div>
          <button onClick={() => setSidePanel(null)} aria-label="بستن پنل" className="px-3 text-gray-600 hover:text-gray-300 transition-colors flex-shrink-0">
            <X className="w-4 h-4" />
          </button>
        </>
      ) : sidePanel === 'diagnostics' ? (
        <>
          <div className="flex-1 flex items-center px-3 py-2.5 gap-2">
            <Activity className="w-4 h-4 text-teal-400 flex-shrink-0" />
            <span className="text-sm font-medium text-teal-400">کیفیت اتصال</span>
          </div>
          <button onClick={() => setSidePanel(null)} aria-label="بستن پنل" className="px-3 text-gray-600 hover:text-gray-300 transition-colors flex-shrink-0">
            <X className="w-4 h-4" />
          </button>
        </>
      ) : (
        <>
          {(['chat','participants','polls','whiteboard'] as SidePanel[]).filter(p => {
            if (p === 'chat') return allowChat;
            if (p === 'whiteboard') return true;
            if (p === 'polls') return true;
            return true;
          }).map(p => (
              <button key={p!} onClick={() => togglePanel(p)}
                className={`flex-1 py-2.5 text-xs font-medium transition-colors ${sidePanel === p ? 'text-teal-400 border-b-2 border-teal-400' : 'text-gray-500 hover:text-gray-300'}`}>
                {p === 'chat' ? 'چت' : p === 'participants' ? (
                  <span className="flex items-center justify-center gap-1">
                    افراد
                    {sortedQueueLength > 0 && (
                      <span className="w-4 h-4 rounded-full bg-yellow-500 text-black text-[10px] flex items-center justify-center font-bold">
                        {sortedQueueLength}
                      </span>
                    )}
                  </span>
                ) : p === 'polls' ? 'نظرسنجی' : 'وایت‌بورد'}
              </button>
            ))}
            <button onClick={() => setSidePanel(null)} aria-label="بستن پنل" className="px-3 text-gray-600 hover:text-gray-300 transition-colors flex-shrink-0">
              <X className="w-4 h-4" />
            </button>
          </>
      )}
    </div>
  );
}
