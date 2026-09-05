import { Activity, BarChart3, Hand, Lock, MessageCircle, MessageSquare, Pencil, Presentation, Radio, Settings2, ShieldCheck, Square, Unlock, Users } from 'lucide-react';
import type { ConferencePanel } from '../../types/conference.types';
import { useConferenceTooltips } from '../../../../components/VideoConference/useConferenceTooltips';

interface Props {
  panel: ConferencePanel;
  messageCount: number;
  privateUnreadCount: number;
  canPrivateChat: boolean;
  canModeratorChat: boolean;
  canPolls: boolean;
  canWhiteboard: boolean;
  canPresentations: boolean;
  canDiagnostics: boolean;
  raised: boolean;
  raisedCount: number;
  busy: string | null;
  recording: boolean;
  locked: boolean;
  canStartRecording: boolean;
  canStopRecording: boolean;
  canLockRoom: boolean;
  canEndMeeting: boolean;
  onPanelChange: (panel: ConferencePanel) => void;
  onToggleRaise: () => Promise<void>;
  onToggleRecording: () => Promise<void>;
  onToggleLock: () => Promise<void>;
  onEnd: () => Promise<void>;
}

export function ConferenceToolsBar({
  panel,
  messageCount,
  privateUnreadCount,
  canPrivateChat,
  canModeratorChat,
  canPolls,
  canWhiteboard,
  canPresentations,
  canDiagnostics,
  raised,
  raisedCount,
  busy,
  recording,
  locked,
  canStartRecording,
  canStopRecording,
  canLockRoom,
  onPanelChange,
  onToggleRaise,
  onToggleRecording,
  onToggleLock,
}: Props) {
  useConferenceTooltips();
  const togglePanel = (next: Exclude<ConferencePanel, null>) => onPanelChange(panel === next ? null : next);
  const canToggleRecording = recording ? canStopRecording : canStartRecording;

  return (
    <div
      className="absolute inset-x-0 bottom-0 z-30 flex min-h-[76px] items-center gap-2 border-t border-white/10 bg-slate-900/95 px-2 pb-[max(8px,env(safe-area-inset-bottom))] pt-2 shadow-[0_-10px_30px_rgba(0,0,0,.18)] backdrop-blur"
      dir="rtl"
      role="toolbar"
      aria-label="کنترل‌های جلسه"
    >
      <div
        id="conference-media-controls-slot"
        className="relative flex shrink-0 items-center gap-2 border-l border-white/10 pl-2"
      />

      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto overscroll-x-contain py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <button onClick={() => togglePanel('chat')} className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl hover:bg-white/10" aria-label="گفتگوی جلسه"><MessageCircle className="h-5 w-5" />{messageCount > 0 && <span className="absolute -left-1 -top-1 min-w-4 rounded-full bg-violet-500 px-1 text-[9px]">{messageCount > 99 ? '99+' : messageCount}</span>}</button>
        {canPrivateChat && (
          <button onClick={() => togglePanel('private-chat')} className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl hover:bg-white/10" aria-label="پیام خصوصی">
            <MessageSquare className="h-5 w-5" />
            {privateUnreadCount > 0 && <span className="absolute -left-1 -top-1 min-w-4 rounded-full bg-rose-500 px-1 text-[9px]">{privateUnreadCount > 99 ? '99+' : privateUnreadCount}</span>}
          </button>
        )}
        {canModeratorChat && (
          <button onClick={() => togglePanel('moderator-chat')} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-amber-300 hover:bg-white/10" aria-label="گفتگوی مدیران">
            <ShieldCheck className="h-5 w-5" />
          </button>
        )}
        {canPolls && (
          <button onClick={() => togglePanel('polls')} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-cyan-300 hover:bg-white/10" aria-label="نظرسنجی‌ها">
            <BarChart3 className="h-5 w-5" />
          </button>
        )}
        {canWhiteboard && (
          <button onClick={() => togglePanel('whiteboard')} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-emerald-300 hover:bg-white/10" aria-label="تخته سفید">
            <Pencil className="h-5 w-5" />
          </button>
        )}
        {canPresentations && (
          <button onClick={() => togglePanel('presentation')} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sky-300 hover:bg-white/10" aria-label="ارائه و اشتراک فایل">
            <Presentation className="h-5 w-5" />
          </button>
        )}
        {canDiagnostics && (
          <button onClick={() => togglePanel('diagnostics')} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-lime-300 hover:bg-white/10" aria-label="تشخیص پیشرفته شبکه">
            <Activity className="h-5 w-5" />
          </button>
        )}
        <button onClick={() => void onToggleRaise()} disabled={busy === 'raise'} className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${raised ? 'bg-amber-500 text-slate-950' : 'hover:bg-white/10'}`} aria-label={raised ? 'پایین آوردن دست' : 'بالا بردن دست'}><Hand className="h-5 w-5" /></button>
        <button onClick={() => togglePanel('participants')} className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl hover:bg-white/10" aria-label="شرکت‌کنندگان"><Users className="h-5 w-5" />{raisedCount > 0 && <span className="absolute -left-1 -top-1 rounded-full bg-amber-500 px-1.5 text-[9px] font-bold text-slate-950">{raisedCount}</span>}</button>
        <button onClick={() => togglePanel('devices')} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl hover:bg-white/10" aria-label="انتخاب دستگاه"><Settings2 className="h-5 w-5" /></button>
        {canToggleRecording && <button onClick={() => void onToggleRecording()} disabled={busy === 'recording'} className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${recording ? 'bg-rose-600' : 'hover:bg-white/10'}`} aria-label={recording ? 'توقف ضبط' : 'شروع ضبط'}>{recording ? <Square className="h-4 w-4 fill-current" /> : <Radio className="h-5 w-5" />}</button>}
        {canLockRoom && <button onClick={() => void onToggleLock()} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl hover:bg-white/10" aria-label={locked ? 'باز کردن قفل جلسه' : 'قفل جلسه'}>{locked ? <Unlock className="h-5 w-5" /> : <Lock className="h-5 w-5" />}</button>}
      </div>
    </div>
  );
}
