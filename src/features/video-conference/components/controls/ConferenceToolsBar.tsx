import { useState } from 'react';
import { Activity, BarChart3, Hand, Lock, MessageCircle, MessageSquare, MoreHorizontal, Pencil, Presentation, Radio, Settings2, ShieldCheck, Square, Unlock, Users } from 'lucide-react';
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
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const togglePanel = (next: Exclude<ConferencePanel, null>) => onPanelChange(panel === next ? null : next);
  const openMobilePanel = (next: Exclude<ConferencePanel, null>) => {
    setMobileMoreOpen(false);
    togglePanel(next);
  };
  const canToggleRecording = recording ? canStopRecording : canStartRecording;
  const lockBusy = busy === 'lock:' || busy === 'unlock:';
  const mobileToolClass = 'relative flex h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 text-[10px] font-medium text-slate-200 transition hover:bg-white/10 disabled:opacity-50';

  return (
    <div
      className="absolute inset-x-0 bottom-0 z-30 flex min-h-[60px] items-center gap-1 border-t border-white/10 bg-slate-900/95 px-1.5 pb-[max(6px,env(safe-area-inset-bottom))] pt-1.5 shadow-[0_-10px_30px_rgba(0,0,0,.18)] backdrop-blur sm:min-h-[76px] sm:gap-2 sm:px-2 sm:pb-[max(8px,env(safe-area-inset-bottom))] sm:pt-2"
      dir="rtl"
      role="toolbar"
      aria-label="کنترل‌های جلسه"
    >
      <div
        id="conference-media-controls-slot"
        className="relative flex shrink-0 items-center gap-1 border-l border-white/10 pl-1 sm:gap-2 sm:pl-2"
      />

      <div className="flex min-w-0 flex-1 items-center justify-end gap-1 sm:hidden">
        <button
          onClick={() => togglePanel('chat')}
          className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${panel === 'chat' ? 'bg-white/10' : 'hover:bg-white/10'}`}
          aria-label="گفتگوی جلسه"
          aria-pressed={panel === 'chat'}
        >
          <MessageCircle className="h-5 w-5" />
          {messageCount > 0 && <span className="absolute -left-1 -top-1 min-w-4 rounded-full bg-violet-500 px-1 text-[9px]">{messageCount > 99 ? '99+' : messageCount}</span>}
        </button>

        <button
          onClick={() => togglePanel('participants')}
          className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${panel === 'participants' ? 'bg-white/10' : 'hover:bg-white/10'}`}
          aria-label="شرکت‌کنندگان"
          aria-pressed={panel === 'participants'}
        >
          <Users className="h-5 w-5" />
          {raisedCount > 0 && <span className="absolute -left-1 -top-1 rounded-full bg-amber-500 px-1.5 text-[9px] font-bold text-slate-950">{raisedCount}</span>}
        </button>

        <button
          type="button"
          onClick={() => setMobileMoreOpen((current) => !current)}
          className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${mobileMoreOpen ? 'bg-white/15' : 'hover:bg-white/10'}`}
          aria-label="ابزارهای بیشتر جلسه"
          aria-expanded={mobileMoreOpen}
        >
          <MoreHorizontal className="h-5 w-5" />
          {privateUnreadCount > 0 && (
            <span className="absolute -left-1 -top-1 min-w-4 rounded-full bg-rose-500 px-1 text-[9px]">
              {privateUnreadCount > 99 ? '99+' : privateUnreadCount}
            </span>
          )}
        </button>
      </div>

      <div
        className={
          mobileMoreOpen
            ? 'absolute inset-x-2 bottom-full mb-2 grid max-h-[52dvh] grid-cols-3 gap-1.5 overflow-y-auto rounded-2xl border border-white/10 bg-slate-900/98 p-2 shadow-2xl backdrop-blur sm:hidden'
            : 'hidden'
        }
        aria-label="ابزارهای بیشتر جلسه"
      >
        <div id="conference-mobile-media-more-slot" className="contents" />

        {canPrivateChat && (
          <button onClick={() => openMobilePanel('private-chat')} className={mobileToolClass}>
            <MessageSquare className="h-5 w-5" />
            <span>پیام خصوصی</span>
            {privateUnreadCount > 0 && <span className="absolute left-1.5 top-1 min-w-4 rounded-full bg-rose-500 px-1 text-[9px]">{privateUnreadCount > 99 ? '99+' : privateUnreadCount}</span>}
          </button>
        )}
        {canModeratorChat && (
          <button onClick={() => openMobilePanel('moderator-chat')} className={mobileToolClass}>
            <ShieldCheck className="h-5 w-5 text-amber-300" />
            <span>گفتگوی مدیران</span>
          </button>
        )}
        {canPolls && (
          <button onClick={() => openMobilePanel('polls')} className={mobileToolClass}>
            <BarChart3 className="h-5 w-5 text-cyan-300" />
            <span>نظرسنجی</span>
          </button>
        )}
        {canWhiteboard && (
          <button onClick={() => openMobilePanel('whiteboard')} className={mobileToolClass}>
            <Pencil className="h-5 w-5 text-emerald-300" />
            <span>تخته سفید</span>
          </button>
        )}
        {canPresentations && (
          <button onClick={() => openMobilePanel('presentation')} className={mobileToolClass}>
            <Presentation className="h-5 w-5 text-sky-300" />
            <span>ارائه</span>
          </button>
        )}
        {canDiagnostics && (
          <button onClick={() => openMobilePanel('diagnostics')} className={mobileToolClass}>
            <Activity className="h-5 w-5 text-lime-300" />
            <span>شبکه</span>
          </button>
        )}
        <button
          onClick={() => { setMobileMoreOpen(false); void onToggleRaise(); }}
          disabled={busy === 'raise'}
          className={`${mobileToolClass} ${raised ? 'bg-amber-500 text-slate-950' : ''}`}
        >
          <Hand className="h-5 w-5" />
          <span>{raised ? 'پایین آوردن دست' : 'بالا بردن دست'}</span>
        </button>
        <button onClick={() => openMobilePanel('devices')} className={mobileToolClass}>
          <Settings2 className="h-5 w-5" />
          <span>دستگاه‌ها</span>
        </button>
        {canToggleRecording && (
          <button
            onClick={() => { setMobileMoreOpen(false); void onToggleRecording(); }}
            disabled={busy === 'recording'}
            className={`${mobileToolClass} ${recording ? 'bg-rose-600 text-white' : ''}`}
          >
            {recording ? <Square className="h-4 w-4 fill-current" /> : <Radio className="h-5 w-5" />}
            <span>{recording ? 'توقف ضبط' : 'شروع ضبط'}</span>
          </button>
        )}
        {canLockRoom && (
          <button
            onClick={() => { setMobileMoreOpen(false); void onToggleLock(); }}
            disabled={lockBusy}
            className={`${mobileToolClass} ${locked ? 'bg-amber-400 text-slate-950' : ''}`}
            aria-pressed={locked}
          >
            {locked ? <Unlock className="h-5 w-5" /> : <Lock className="h-5 w-5" />}
            <span>{locked ? 'قفل فعال' : 'قفل جلسه'}</span>
          </button>
        )}
      </div>

      <div className="hidden min-w-0 flex-1 items-center gap-1 overflow-x-auto overscroll-x-contain py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:flex">
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
        {canLockRoom && (
          <button
            onClick={() => void onToggleLock()}
            disabled={lockBusy}
            aria-label={locked ? 'باز کردن قفل جلسه' : 'قفل جلسه'}
            aria-pressed={locked}
            className={
              `flex h-10 shrink-0 items-center gap-2 rounded-xl border px-3 text-xs font-bold transition `
              + (locked
                ? 'border-amber-300/70 bg-amber-400 text-slate-950 shadow-[0_0_0_1px_rgba(251,191,36,.18)]'
                : 'border-white/15 bg-white/5 text-slate-200 hover:border-white/25 hover:bg-white/10')
              + ' disabled:cursor-wait disabled:opacity-60'
            }
          >
            {locked ? <Unlock className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
            <span>{locked ? 'قفل فعال' : 'قفل جلسه'}</span>
          </button>
        )}
      </div>
    </div>
  );
}
