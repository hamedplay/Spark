import { Activity, UserPlus, Check, Copy, LayoutGrid, MonitorPlay, PanelRight, Minimize2, Maximize2, Users } from 'lucide-react';
import type { ConferenceRoom, LayoutMode } from '../types';

type NetworkQuality = 'excellent' | 'good' | 'fair' | 'poor';

export function TopBar(props: {
  room: ConferenceRoom;
  duration: number;
  secondsLeft: number | null;
  fmt: (s: number) => string;
  myQuality: NetworkQuality;
  qualityColor: Record<string, string>;
  onInvite?: () => void;
  copyCode: () => void;
  codeCopied: boolean;
  layoutMode: LayoutMode;
  setLayoutMode: (m: LayoutMode) => void;
  isFullscreen: boolean;
  setIsFullscreen: (fn: (v: boolean) => boolean) => void;
  participantCount: number;
}) {
  const { room, duration, secondsLeft, fmt, myQuality, qualityColor, onInvite, copyCode, codeCopied, layoutMode, setLayoutMode, isFullscreen, setIsFullscreen, participantCount } = props;

  return (
    <div className="flex items-center justify-between px-3 py-2 bg-gray-900/95 border-b border-gray-800 flex-shrink-0 gap-2">
      <div className="flex items-center gap-2 min-w-0">
        <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse flex-shrink-0" />
        <span className="font-bold text-sm truncate max-w-[120px] sm:max-w-xs">{room.name || 'جلسه ویدیویی'}</span>
        {/* Meeting duration / countdown */}
        {secondsLeft !== null ? (
          <span className={`text-xs font-mono flex-shrink-0 flex items-center gap-1 ${
            secondsLeft <= 300 ? 'text-red-400 animate-pulse' : 'text-amber-400'
          }`}>
            ⏱ {secondsLeft > 0 ? fmt(secondsLeft) : 'تمام شد'}
          </span>
        ) : (
          <span className="text-gray-400 text-xs font-mono flex-shrink-0">{fmt(duration)}</span>
        )}
        <span className={`hidden sm:flex items-center gap-1 text-xs flex-shrink-0 ${qualityColor[myQuality]}`}>
          <Activity className="w-3 h-3" />{myQuality}
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        {onInvite && (
          <button onClick={onInvite} title="دعوت" className="flex items-center gap-1 px-2.5 py-1.5 bg-blue-700 hover:bg-blue-600 rounded-lg text-xs font-medium transition-colors">
            <UserPlus className="w-3.5 h-3.5" /><span className="hidden sm:inline">دعوت</span>
          </button>
        )}
        <button onClick={copyCode} title="کپی کد جلسه" className="flex items-center gap-1 px-2.5 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-lg text-xs font-mono transition-colors">
          {codeCopied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
          <span className="hidden sm:inline">{room.code}</span>
        </button>
        {/* Layout mode toggle — 3 modes */}
        <div className="hidden sm:flex items-center gap-0.5 bg-gray-800 rounded-lg p-0.5">
          {([
            { mode: 'gallery', icon: LayoutGrid, title: 'نمای گالری' },
            { mode: 'speaker', icon: MonitorPlay, title: 'نمای سخنران' },
            { mode: 'sidebar', icon: PanelRight, title: 'نمای نوار کناری' },
          ] as const).map(({ mode, icon: Icon, title }) => (
            <button
              key={mode}
              onClick={() => setLayoutMode(mode)}
              title={title}
              aria-pressed={layoutMode === mode}
              className={`p-1.5 rounded-md transition-colors ${layoutMode === mode ? 'bg-teal-600 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-700'}`}
            >
              <Icon className="w-3.5 h-3.5" />
            </button>
          ))}
        </div>
        <button onClick={() => setIsFullscreen(v => !v)} title="تمام‌صفحه" className="p-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 transition-colors">
          {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
        </button>
        <div className="flex items-center gap-1 px-2 py-1.5 bg-gray-800 rounded-lg text-xs flex-shrink-0">
          <Users className="w-3.5 h-3.5 text-teal-400" /><span>{participantCount}</span>
        </div>
      </div>
    </div>
  );
}
