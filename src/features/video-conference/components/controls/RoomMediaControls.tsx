import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Camera, CameraOff, ChevronUp, LogOut, Mic, MicOff, MonitorUp, PhoneOff, Volume2, VolumeX, X } from 'lucide-react';

const REACTION_OPTIONS = ['👍', '❤️', '😂', '🎉', '👏', '😮'] as const;

interface Props {
  micEnabled: boolean;
  cameraEnabled: boolean;
  screenEnabled: boolean;
  speakerMuted: boolean;
  allowMicrophone: boolean;
  allowCamera: boolean;
  allowScreenShare: boolean;
  allowReactions: boolean;
  reactionError?: string;
  canEndMeeting?: boolean;
  onToggleMic: () => void;
  onToggleCamera: () => void;
  onToggleScreen: () => void;
  onToggleSpeaker: () => void;
  onReaction: (reaction: string) => void;
  onLeave: () => void | Promise<void>;
  onEndMeeting?: () => void | Promise<void>;
}

export function RoomMediaControls({
  micEnabled,
  cameraEnabled,
  screenEnabled,
  speakerMuted,
  allowMicrophone,
  allowCamera,
  allowScreenShare,
  allowReactions,
  reactionError,
  canEndMeeting = false,
  onToggleMic,
  onToggleCamera,
  onToggleScreen,
  onToggleSpeaker,
  onReaction,
  onLeave,
  onEndMeeting,
}: Props) {
  const [reactionPickerOpen, setReactionPickerOpen] = useState(false);
  const [exitMenuOpen, setExitMenuOpen] = useState(false);
  const [exitBusy, setExitBusy] = useState<'leave' | 'end' | null>(null);
  const [exitError, setExitError] = useState('');
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const nextTarget = document.getElementById('conference-media-controls-slot');
    if (nextTarget !== portalTarget) setPortalTarget(nextTarget);
  });

  const chooseReaction = (reaction: string) => {
    setReactionPickerOpen(false);
    onReaction(reaction);
  };

  const leaveOnly = async () => {
    if (exitBusy) return;
    setExitBusy('leave');
    setExitError('');
    try {
      await onLeave();
    } catch (error) {
      console.error('[VideoConference] leave failed', error);
      setExitError('خروج از جلسه انجام نشد. دوباره تلاش کنید.');
      setExitBusy(null);
    }
  };

  const endForAll = async () => {
    if (!canEndMeeting || !onEndMeeting || exitBusy) return;
    setExitBusy('end');
    setExitError('');
    try {
      await onEndMeeting();
    } catch (error) {
      console.error('[VideoConference] end meeting failed', error);
      setExitError('اتمام جلسه انجام نشد. دوباره تلاش کنید.');
      setExitBusy(null);
    }
  };

  const controls = (
    <>
      {reactionError && (
        <div
          className="absolute bottom-14 right-0 z-50 max-w-64 rounded-lg bg-rose-950/95 px-3 py-2 text-center text-[10px] text-rose-100 shadow-lg"
          role="status"
        >
          {reactionError}
        </div>
      )}

      {allowMicrophone && (
        <button
          aria-label={micEnabled ? 'قطع میکروفون' : 'فعال کردن میکروفون'}
          onClick={onToggleMic}
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition ${micEnabled ? 'bg-slate-700 hover:bg-slate-600' : 'bg-rose-600 hover:bg-rose-500'}`}
        >
          {micEnabled ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
        </button>
      )}
      {allowCamera && (
        <button
          aria-label={cameraEnabled ? 'خاموش کردن دوربین' : 'فعال کردن دوربین'}
          onClick={onToggleCamera}
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition ${cameraEnabled ? 'bg-slate-700 hover:bg-slate-600' : 'bg-rose-600 hover:bg-rose-500'}`}
        >
          {cameraEnabled ? <Camera className="h-5 w-5" /> : <CameraOff className="h-5 w-5" />}
        </button>
      )}
      {allowScreenShare && (
        <button
          aria-label={screenEnabled ? 'توقف اشتراک صفحه' : 'اشتراک صفحه'}
          onClick={onToggleScreen}
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition ${screenEnabled ? 'bg-violet-600 hover:bg-violet-500' : 'bg-slate-700 hover:bg-slate-600'}`}
        >
          <MonitorUp className="h-5 w-5" />
        </button>
      )}

      <button
        type="button"
        aria-label={speakerMuted ? 'فعال کردن صدای جلسه' : 'بی‌صدا کردن صدای جلسه'}
        aria-pressed={speakerMuted}
        onClick={onToggleSpeaker}
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition ${speakerMuted ? 'bg-amber-600 hover:bg-amber-500' : 'bg-slate-700 hover:bg-slate-600'}`}
      >
        {speakerMuted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
      </button>

      {allowReactions && (
        <div className="relative shrink-0">
          {reactionPickerOpen && (
            <div className="absolute bottom-14 right-0 z-50 flex gap-1 rounded-2xl border border-white/10 bg-slate-900/95 p-1.5 shadow-2xl backdrop-blur">
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
            className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-700 text-xl transition hover:bg-slate-600"
          >
            👏
          </button>
        </div>
      )}

      <div className="relative shrink-0">
        {exitMenuOpen && (
          <div className="absolute bottom-14 right-0 z-[70] w-64 overflow-hidden rounded-2xl border border-white/10 bg-slate-900/95 p-2 shadow-2xl backdrop-blur" dir="rtl">
            <div className="mb-1 flex items-center justify-between px-2 py-1">
              <span className="text-xs font-bold text-white">خروج از جلسه</span>
              <button type="button" onClick={() => setExitMenuOpen(false)} className="rounded-lg p-1 text-slate-400 hover:bg-white/10" aria-label="بستن"><X className="h-4 w-4" /></button>
            </div>

            <button
              type="button"
              disabled={Boolean(exitBusy)}
              onClick={() => void leaveOnly()}
              className="flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-right transition hover:bg-white/10 disabled:opacity-50"
            >
              <LogOut className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
              <span>
                <span className="block text-xs font-bold text-white">خروج از جلسه</span>
                <span className="mt-0.5 block text-[10px] leading-4 text-slate-400">فقط شما خارج می‌شوید و جلسه برای سایر افراد ادامه دارد.</span>
              </span>
            </button>

            {canEndMeeting && onEndMeeting && (
              <button
                type="button"
                disabled={Boolean(exitBusy)}
                onClick={() => void endForAll()}
                className="mt-1 flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-right transition hover:bg-rose-500/10 disabled:opacity-50"
              >
                <PhoneOff className="mt-0.5 h-5 w-5 shrink-0 text-rose-400" />
                <span>
                  <span className="block text-xs font-bold text-rose-300">اتمام جلسه برای همه</span>
                  <span className="mt-0.5 block text-[10px] leading-4 text-slate-400">جلسه پایان می‌یابد و همه شرکت‌کنندگان خارج می‌شوند.</span>
                </span>
              </button>
            )}

            {exitError && <div className="mt-2 rounded-lg bg-rose-500/10 px-2 py-1.5 text-[10px] text-rose-300">{exitError}</div>}
          </div>
        )}

        <button
          aria-label="خروج یا اتمام جلسه"
          aria-expanded={exitMenuOpen}
          onClick={() => { setExitError(''); setExitMenuOpen((current) => !current); }}
          className="flex h-11 min-w-12 items-center justify-center gap-1 rounded-full bg-rose-600 px-3 transition hover:bg-rose-500"
        >
          <LogOut className="h-5 w-5" />
          <ChevronUp className={`h-3.5 w-3.5 transition-transform ${exitMenuOpen ? 'rotate-180' : ''}`} />
        </button>
      </div>
    </>
  );

  if (!portalTarget) {
    return <div className="h-[76px] shrink-0" aria-hidden="true" />;
  }

  return (
    <>
      <div className="h-[76px] shrink-0" aria-hidden="true" />
      {createPortal(controls, portalTarget)}
    </>
  );
}
