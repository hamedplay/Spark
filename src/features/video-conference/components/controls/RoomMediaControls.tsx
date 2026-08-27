import { Camera, CameraOff, LogOut, Mic, MicOff, MonitorUp } from 'lucide-react';

interface Props {
  micEnabled: boolean;
  cameraEnabled: boolean;
  screenEnabled: boolean;
  allowScreenShare: boolean;
  allowReactions: boolean;
  onToggleMic: () => void;
  onToggleCamera: () => void;
  onToggleScreen: () => void;
  onReaction: () => void;
  onLeave: () => void;
}

export function RoomMediaControls({
  micEnabled,
  cameraEnabled,
  screenEnabled,
  allowScreenShare,
  allowReactions,
  onToggleMic,
  onToggleCamera,
  onToggleScreen,
  onReaction,
  onLeave,
}: Props) {
  return (
    <footer className="flex min-h-[76px] items-center justify-center gap-2 border-t border-white/10 bg-slate-900/95 px-2 pb-[max(8px,env(safe-area-inset-bottom))] pt-2 backdrop-blur sm:gap-3">
      <button aria-label={micEnabled ? 'قطع میکروفون' : 'فعال کردن میکروفون'} onClick={onToggleMic} className={`flex h-12 w-12 items-center justify-center rounded-full ${micEnabled ? 'bg-slate-700' : 'bg-rose-600'}`}>{micEnabled ? <Mic /> : <MicOff />}</button>
      <button aria-label={cameraEnabled ? 'خاموش کردن دوربین' : 'فعال کردن دوربین'} onClick={onToggleCamera} className={`flex h-12 w-12 items-center justify-center rounded-full ${cameraEnabled ? 'bg-slate-700' : 'bg-rose-600'}`}>{cameraEnabled ? <Camera /> : <CameraOff />}</button>
      {allowScreenShare && <button aria-label="اشتراک صفحه" onClick={onToggleScreen} className={`hidden h-12 w-12 items-center justify-center rounded-full sm:flex ${screenEnabled ? 'bg-violet-600' : 'bg-slate-700'}`}><MonitorUp /></button>}
      {allowReactions && <button aria-label="واکنش تشویق" onClick={onReaction} className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-700 text-xl">👏</button>}
      <button aria-label="خروج از جلسه" onClick={onLeave} className="flex h-12 min-w-12 items-center justify-center rounded-full bg-rose-600 px-3"><LogOut /></button>
    </footer>
  );
}
