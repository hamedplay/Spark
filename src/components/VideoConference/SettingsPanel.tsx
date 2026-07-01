import { Loader as Loader2, Gauge } from 'lucide-react';

export type VideoQuality = 'high' | 'medium' | 'low';

export const VIDEO_QUALITY_PRESETS: Record<VideoQuality, { width: number; height: number; frameRate: number; label: string; res: string; bitrate: string }> = {
  high:   { width: 1280, height: 720,  frameRate: 30, label: 'کیفیت بالا',   res: '1280×720', bitrate: '1.5 Mbps' },
  medium: { width: 640,  height: 480,  frameRate: 24, label: 'کیفیت متوسط', res: '640×480',  bitrate: '800 Kbps' },
  low:    { width: 320,  height: 240,  frameRate: 15, label: 'کیفیت پایین',  res: '320×240',  bitrate: '300 Kbps' },
};

// ترتیب ثابت گزینه‌ها — به Object.keys اتکا نمی‌کنیم
const QUALITY_ORDER: VideoQuality[] = ['high', 'medium', 'low'];

interface Props {
  videoQuality: VideoQuality;
  dataSaverMode: boolean;
  isApplying: boolean;
  onChangeQuality: (q: VideoQuality) => void;
  onToggleDataSaver: () => void;
}

export function SettingsPanel({ videoQuality, dataSaverMode, isApplying, onChangeQuality, onToggleDataSaver }: Props) {
  // وقتی data saver فعال است، کیفیت مؤثر همیشه low است
  const effectiveQuality: VideoQuality = dataSaverMode ? 'low' : videoQuality;

  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-5 min-h-0" dir="rtl">
      {/* Video Quality */}
      <div>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
          <Gauge className="w-3.5 h-3.5" />
          کیفیت ویدیو
        </p>
        <div className="space-y-2">
          {QUALITY_ORDER.map(q => {
            const preset = VIDEO_QUALITY_PRESETS[q];
            // گزینه‌ای که واقعاً در حال اعمال است — در حالت data saver همیشه low
            const active = effectiveQuality === q;
            return (
              <button
                key={q}
                onClick={() => !dataSaverMode && onChangeQuality(q)}
                disabled={dataSaverMode || isApplying}
                aria-pressed={active}
                className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-right
                  ${active
                    ? 'border-teal-500 bg-teal-900/30'
                    : 'border-gray-700 bg-gray-800/50 hover:border-gray-600'}
                  ${dataSaverMode ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
                `}
              >
                <div className={`w-4 h-4 rounded-full border-2 shrink flex items-center justify-center transition-colors
                  ${active ? 'border-teal-400' : 'border-gray-600'}`}>
                  {active && (
                    <div className="w-2 h-2 rounded-full bg-teal-400" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium ${active ? 'text-teal-300' : 'text-gray-200'}`}>
                    {preset.label}
                    {/* نشان‌گر data saver کنار low */}
                    {q === 'low' && dataSaverMode && (
                      <span className="mr-2 text-[10px] text-amber-400 font-normal">(صرفه‌جویی)</span>
                    )}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">{preset.res} · {preset.frameRate}fps · {preset.bitrate}</p>
                </div>
                {active && isApplying && (
                  <Loader2 className="w-4 h-4 text-teal-400 animate-spin shrink" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Data Saver Mode */}
      <div className="p-3 rounded-xl border border-gray-700 bg-gray-800/50">
        <div className="flex items-center justify-between gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-200">حالت صرفه‌جویی داده</p>
            <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">
              کیفیت پایین + 15fps · مصرف اینترنت را کاهش می‌دهد
            </p>
          </div>
          <button
            onClick={onToggleDataSaver}
            disabled={isApplying}
            role="switch"
            aria-checked={dataSaverMode}
            aria-label={dataSaverMode ? 'غیرفعال کردن حالت صرفه‌جویی داده' : 'فعال کردن حالت صرفه‌جویی داده'}
            className={`relative w-11 h-6 rounded-full transition-colors shrink focus:outline-hidden focus-visible:ring-2 focus-visible:ring-teal-400 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-800
              ${dataSaverMode ? 'bg-teal-500' : 'bg-gray-600'}
              ${isApplying ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
          >
            <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all
              ${dataSaverMode ? 'right-0.5' : 'left-0.5'}`} />
          </button>
        </div>
        {dataSaverMode && (
          <p className="mt-2 text-xs text-amber-400/90 flex items-center gap-1">
            <span>فعال — کیفیت ویدیو به پایین‌ترین حالت تنظیم شده است</span>
          </p>
        )}
      </div>
    </div>
  );
}
