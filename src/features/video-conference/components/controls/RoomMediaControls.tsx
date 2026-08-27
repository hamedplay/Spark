import { useState } from 'react';
import { Camera, CameraOff, LogOut, Mic, MicOff, MonitorUp } from 'lucide-react';

const REACTION_OPTIONS = ['👍', '❤️', '😂', '🎉', '👏', '😮'] as const;

interface Props {
  micEnabled: boolean;
  cameraEnabled: boolean;
  screenEnabled: boolean;
  allowMicrophone: boolean;
  allowCamera: boolean;
  allowScreenShare: boolean;
  allowReactions: boolean;
  reactionError?: string;
  onToggleMic: () => void;
  onToggleCamera: () => void;
  onToggleScreen: () => void;
  onReaction: (reaction: string) => void;
  onLeave: () => void;
}

export function RoomMediaControls({
  micEnabled,
  cameraEnabled,
  screenEnabled,
  allowMicrophone,
  allowCamera,
  allowScreenShare,
  allowReactions,
  reactionError,
  onToggleMic,
  onToggleCamera,
  onToggleScreen,
  onReaction,
  onLeave,
}: Props) {
  const [reactionPickerOpen, setReactionPickerOpen] = useState(false);

  const chooseReaction = (reaction: string) => {
    setReactionPickerOpen(false);
    onReaction(reaction);
  };

  return (
    <footer className="relative flex min-h-[76px] items-center justify-center gap-2 border-t border-white/10 bg-slate-900/95 px-2 pb-[max(8px,env(safe-area-inset-bottom))] pt-2 backdrop-blur sm:gap-3">
      {reactionError && (
        <div
          className="absolute bottom-[78px] left-1/2 z-50 -translate-x-1/2 rounded-lg bg-rose-950/95 px-3 py-2 text-center text-[10px] text-rose-100 shadow-lg"
          role="status"
        >
          {reactionError}
        </div>
      )}

      {allowMicrophone && <button aria-label={micEnabled ? 'قطع میکروفون' : 'فعال کردن میکروفون'} onClick={onToggleMic} className={`flex h-12 w-12 items-center justify-center rounded-full ${micEnabled ? 'bg-slate-700' : 'bg-rose-600'}`}>{micEnabled ? <Mic /> : <MicOff />}</button>}
      {allowCamera && <button aria-label={cameraEnabled ? 'خاموش کردن دوربین' : 'فعال کردن دوربین'} onClick={onToggleCamera} className={`flex h-12 w-12 items-center justify-center rounded-full ${cameraEnabled ? 'bg-slate-700' : 'bg-rose-600'}`}>{cameraEnabled ? <Camera /> : <CameraOff />}</button>}
      {allowScreenShare && <button aria-label="اشتراک صفحه" onClick={onToggleScreen} className={`hidden h-12 w-12 items-center justify-center rounded-full sm:flex ${screenEnabled ? 'bg-violet-600' : 'bg-slate-700'}`}><MonitorUp /></button>}

      {allowReactions && (
        <div className="relative">
          {reactionPickerOpen && (
            <div className="absolute bottom-14 left-1/2 z-50 flex -translate-x-1/2 gap-1 rounded-2xl border border-white/10 bg-slate-900/95 p-1.5 shadow-2xl backdrop-blur">
              {REACTION_OPTIONS.map((reaction) => (
                <button
                  key={reaction}
                  type="button"
                  onClick={() => chooseReaction(reaction)}
                  className="flex h-10 w-10 items-center justify-center rounded-xl text-xl hover:bg-white/10"
                  aria-label={`ارسال واکنش ${reaction}`}
                >
                  {reaction}
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            aria-label={reactionPickerOpen ? 'بستن واکنش‌ها' : 'نمایش واکنش‌ها'}
            aria-expanded={reactionPickerOpen}
            onClick={() => setReactionPickerOpen((current) => !current)}
            className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-700 text-xl"
          >
            👏
          </button>
        </div>
      )}

      <button aria-label="خروج از جلسه" onClick={onLeave} className="flex h-12 min-w-12 items-center justify-center rounded-full bg-rose-600 px-3"><LogOut /></button>
    </footer>
  );
}
