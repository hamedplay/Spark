import {
  Mic, MicOff, Video, VideoOff, PhoneOff, MessageSquare, Users, Hand,
  ScreenShare, ScreenShareOff, Smile, ChartBar as BarChart2, PenTool,
  Volume2, VolumeX, ShieldAlert, ChevronUp, ChevronDown, SlidersHorizontal, Activity,
} from 'lucide-react';
import type { ConferenceRoom, SidePanel } from '../types';

export interface BottomControlsProps {
  room: ConferenceRoom;
  isMuted: boolean;
  isVideoOff: boolean;
  isHandRaised: boolean;
  isScreenSharing: boolean;
  isSpeakerMuted: boolean;
  showEmojiPicker: boolean;
  sidePanel: SidePanel;
  isMobile: boolean;
  showAllControls: boolean;
  unreadCount: number;
  sortedQueueLength: number;
  pendingApprovalsLength: number;
  canMuteAll: boolean;
  speakingLimitEnabled: boolean;
  speakingSecs: number;
  myLimitSecs: number;
  onToggleMute: () => void;
  onToggleVideo: () => void;
  onToggleHand: () => void;
  onToggleScreenShare: () => void;
  onToggleEmojiPicker: () => void;
  onTogglePanel: (p: SidePanel) => void;
  onToggleSpeakerMute: () => void;
  onMuteAll: () => void;
  onLeave: () => void;
  onToggleAllControls: () => void;
}

export function BottomControls(props: BottomControlsProps) {
  const {
    room, isMuted, isVideoOff, isHandRaised, isScreenSharing, isSpeakerMuted,
    showEmojiPicker, sidePanel, isMobile, showAllControls,
    unreadCount, sortedQueueLength, pendingApprovalsLength, canMuteAll,
    speakingLimitEnabled, speakingSecs, myLimitSecs,
    onToggleMute, onToggleVideo, onToggleHand, onToggleScreenShare,
    onToggleEmojiPicker, onTogglePanel, onToggleSpeakerMute, onMuteAll, onLeave, onToggleAllControls,
  } = props;

  const remainingSpeakingSecs = Math.max(0, myLimitSecs - speakingSecs);

  const coreControls = (
    <>
      <button onClick={onToggleMute} title={isMuted ? 'فعال کردن میکروفون' : 'قطع میکروفون'} aria-pressed={isMuted}
        className={`relative w-11 h-11 rounded-full flex items-center justify-center transition-all shadow-lg flex-shrink-0 ${isMuted ? 'bg-red-600 hover:bg-red-500' : 'bg-gray-700 hover:bg-gray-600'}`}>
        {speakingLimitEnabled && !isMuted && (
          <span
            className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-amber-500 text-[10px] leading-5 text-black font-bold tabular-nums shadow"
            title="زمان باقی‌مانده تا قطع خودکار میکروفون"
          >
            {remainingSpeakingSecs.toLocaleString('fa-IR')}
          </span>
        )}
        {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
      </button>
      <button onClick={onToggleVideo} title={isVideoOff ? 'فعال کردن دوربین' : 'قطع دوربین'} aria-pressed={isVideoOff}
        className={`w-11 h-11 rounded-full flex items-center justify-center transition-all shadow-lg flex-shrink-0 ${isVideoOff ? 'bg-red-600 hover:bg-red-500' : 'bg-gray-700 hover:bg-gray-600'}`}>
        {isVideoOff ? <VideoOff className="w-5 h-5" /> : <Video className="w-5 h-5" />}
      </button>
      {room.allow_chat && (
        <button onClick={() => onTogglePanel('chat')} title="چت"
          className={`relative w-11 h-11 rounded-full flex items-center justify-center transition-all shadow-lg flex-shrink-0 ${sidePanel === 'chat' ? 'bg-teal-600' : 'bg-gray-700 hover:bg-gray-600'}`}>
          <MessageSquare className="w-5 h-5" />
          {unreadCount > 0 && <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full text-xs flex items-center justify-center font-bold">{unreadCount > 9 ? '9+' : unreadCount}</span>}
        </button>
      )}
      <button onClick={onLeave} title="پایان جلسه"
        className="w-12 h-11 rounded-full bg-red-600 hover:bg-red-500 flex items-center justify-center transition-all shadow-lg flex-shrink-0">
        <PhoneOff className="w-5 h-5" />
      </button>
    </>
  );

  if (isMobile) {
    return (
      <>
        <div className="flex items-center justify-center gap-2 px-3 py-2.5">
          {coreControls}
          <button onClick={onToggleAllControls} aria-label="بیشتر"
            className="w-11 h-11 rounded-full flex items-center justify-center bg-gray-700 hover:bg-gray-600 transition-all flex-shrink-0">
            {showAllControls ? <ChevronDown className="w-5 h-5" /> : <ChevronUp className="w-5 h-5" />}
          </button>
        </div>
        {showAllControls && (
          <div className="flex items-center justify-center gap-2 px-3 pb-3 flex-wrap">
            {room.allow_screen_share && (
              <button onClick={onToggleScreenShare} title="اشتراک صفحه"
                className={`w-11 h-11 rounded-full flex items-center justify-center transition-all shadow-lg ${isScreenSharing ? 'bg-teal-600 hover:bg-teal-500' : 'bg-gray-700 hover:bg-gray-600'}`}>
                {isScreenSharing ? <ScreenShareOff className="w-5 h-5" /> : <ScreenShare className="w-5 h-5" />}
              </button>
            )}
            <button onClick={onToggleHand} title="بلند کردن دست" aria-pressed={isHandRaised}
              className={`w-11 h-11 rounded-full flex items-center justify-center transition-all shadow-lg ${isHandRaised ? 'bg-yellow-500 hover:bg-yellow-400' : 'bg-gray-700 hover:bg-gray-600'}`}>
              <Hand className="w-5 h-5" />
            </button>
            {room.allow_reactions && (
              <button onClick={onToggleEmojiPicker} title="واکنش"
                aria-pressed={showEmojiPicker}
                className={`w-11 h-11 rounded-full flex items-center justify-center transition-all shadow-lg ${showEmojiPicker ? 'bg-teal-600' : 'bg-gray-700 hover:bg-gray-600'}`}>
                <Smile className="w-5 h-5" />
              </button>
            )}
            <button onClick={() => onTogglePanel('participants')} title="شرکت‌کنندگان"
              className={`relative w-11 h-11 rounded-full flex items-center justify-center transition-all shadow-lg ${sidePanel === 'participants' ? 'bg-teal-600' : 'bg-gray-700 hover:bg-gray-600'}`}>
              <Users className="w-5 h-5" />
              {(sortedQueueLength + pendingApprovalsLength) > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 bg-yellow-500 rounded-full text-[9px] text-black flex items-center justify-center font-bold">{sortedQueueLength + pendingApprovalsLength}</span>
              )}
            </button>
            <button onClick={() => onTogglePanel('polls')} title="نظرسنجی"
              className={`w-11 h-11 rounded-full flex items-center justify-center transition-all shadow-lg ${sidePanel === 'polls' ? 'bg-teal-600' : 'bg-gray-700 hover:bg-gray-600'}`}>
              <BarChart2 className="w-5 h-5" />
            </button>
            <button onClick={() => onTogglePanel('whiteboard')} title="وایت‌بورد"
              className={`w-11 h-11 rounded-full flex items-center justify-center transition-all shadow-lg ${sidePanel === 'whiteboard' ? 'bg-teal-600' : 'bg-gray-700 hover:bg-gray-600'}`}>
              <PenTool className="w-5 h-5" />
            </button>
            <button onClick={() => onTogglePanel('settings')} title="تنظیمات"
              className={`w-11 h-11 rounded-full flex items-center justify-center transition-all shadow-lg ${sidePanel === 'settings' ? 'bg-teal-600' : 'bg-gray-700 hover:bg-gray-600'}`}>
              <SlidersHorizontal className="w-5 h-5" />
            </button>
            <button onClick={() => onTogglePanel('diagnostics')} title="کیفیت اتصال"
              className={`w-11 h-11 rounded-full flex items-center justify-center transition-all shadow-lg ${sidePanel === 'diagnostics' ? 'bg-teal-600' : 'bg-gray-700 hover:bg-gray-600'}`}>
              <Activity className="w-5 h-5" />
            </button>
            <button onClick={onToggleSpeakerMute} title={isSpeakerMuted ? 'فعال کردن صدا' : 'قطع صدا'}
              className={`w-11 h-11 rounded-full flex items-center justify-center transition-all shadow-lg ${isSpeakerMuted ? 'bg-red-600 hover:bg-red-500' : 'bg-gray-700 hover:bg-gray-600'}`}>
              {isSpeakerMuted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
            </button>
            {canMuteAll && (
              <button onClick={onMuteAll} title="قطع میکروفون همه"
                className="w-11 h-11 rounded-full flex items-center justify-center transition-all shadow-lg bg-amber-700 hover:bg-amber-600">
                <ShieldAlert className="w-5 h-5" />
              </button>
            )}
          </div>
        )}
      </>
    );
  }

  return (
    <div role="toolbar" aria-label="کنترل‌های جلسه" className="flex items-center justify-center gap-2 px-3 py-3 overflow-x-auto">
      <button onClick={onToggleMute} aria-label={isMuted ? 'فعال کردن میکروفون' : 'قطع میکروفون'} aria-pressed={isMuted}
        className={`relative w-12 h-12 rounded-full flex items-center justify-center transition-all shadow-lg flex-shrink-0 ${isMuted ? 'bg-red-600 hover:bg-red-500' : 'bg-gray-700 hover:bg-gray-600'}`}>
        {speakingLimitEnabled && !isMuted && (
          <span
            className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-amber-500 text-[10px] leading-5 text-black font-bold tabular-nums shadow"
            title="زمان باقی‌مانده تا قطع خودکار میکروفون"
          >
            {remainingSpeakingSecs.toLocaleString('fa-IR')}
          </span>
        )}
        {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
      </button>
      <button onClick={onToggleVideo} aria-label={isVideoOff ? 'فعال کردن دوربین' : 'قطع دوربین'} aria-pressed={isVideoOff}
        className={`w-12 h-12 rounded-full flex items-center justify-center transition-all shadow-lg flex-shrink-0 ${isVideoOff ? 'bg-red-600 hover:bg-red-500' : 'bg-gray-700 hover:bg-gray-600'}`}>
        {isVideoOff ? <VideoOff className="w-5 h-5" /> : <Video className="w-5 h-5" />}
      </button>
      {room.allow_screen_share && (
        <button onClick={onToggleScreenShare} aria-label={isScreenSharing ? 'توقف اشتراک صفحه' : 'شروع اشتراک صفحه'} aria-pressed={isScreenSharing}
          className={`w-12 h-12 rounded-full flex items-center justify-center transition-all shadow-lg flex-shrink-0 ${isScreenSharing ? 'bg-teal-600 hover:bg-teal-500' : 'bg-gray-700 hover:bg-gray-600'}`}>
          {isScreenSharing ? <ScreenShareOff className="w-5 h-5" /> : <ScreenShare className="w-5 h-5" />}
        </button>
      )}
      <button onClick={onToggleHand} aria-label={isHandRaised ? 'پایین آوردن دست' : 'بلند کردن دست'} aria-pressed={isHandRaised}
        className={`w-12 h-12 rounded-full flex items-center justify-center transition-all shadow-lg flex-shrink-0 ${isHandRaised ? 'bg-yellow-500 hover:bg-yellow-400' : 'bg-gray-700 hover:bg-gray-600'}`}>
        <Hand className="w-5 h-5" />
      </button>
      {room.allow_reactions && (
        <div className="flex-shrink-0">
          <button onClick={onToggleEmojiPicker} aria-label="ارسال واکنش ایموجی" aria-expanded={showEmojiPicker}
            aria-pressed={showEmojiPicker}
            className={`w-12 h-12 rounded-full flex items-center justify-center transition-all shadow-lg ${showEmojiPicker ? 'bg-teal-600' : 'bg-gray-700 hover:bg-gray-600'}`}>
            <Smile className="w-5 h-5" />
          </button>
        </div>
      )}
      {room.allow_chat && (
        <button onClick={() => onTogglePanel('chat')} aria-label="باز کردن پنل چت" aria-pressed={sidePanel === 'chat'}
          className={`relative w-12 h-12 rounded-full flex items-center justify-center transition-all shadow-lg flex-shrink-0 ${sidePanel === 'chat' ? 'bg-teal-600' : 'bg-gray-700 hover:bg-gray-600'}`}>
          <MessageSquare className="w-5 h-5" />
          {unreadCount > 0 && <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full text-xs flex items-center justify-center font-bold">{unreadCount > 9 ? '9+' : unreadCount}</span>}
        </button>
      )}
      <button onClick={() => onTogglePanel('participants')} aria-label="باز کردن لیست شرکت‌کنندگان" aria-pressed={sidePanel === 'participants'}
        className={`relative w-12 h-12 rounded-full flex items-center justify-center transition-all shadow-lg flex-shrink-0 ${sidePanel === 'participants' ? 'bg-teal-600' : 'bg-gray-700 hover:bg-gray-600'}`}>
        <Users className="w-5 h-5" />
        {(sortedQueueLength + pendingApprovalsLength) > 0 && (
          <span className="absolute -top-1 -right-1 w-5 h-5 bg-yellow-500 rounded-full text-xs text-black flex items-center justify-center font-bold">{sortedQueueLength + pendingApprovalsLength}</span>
        )}
      </button>
      <button onClick={() => onTogglePanel('polls')} aria-label="باز کردن نظرسنجی" aria-pressed={sidePanel === 'polls'}
        className={`w-12 h-12 rounded-full flex items-center justify-center transition-all shadow-lg flex-shrink-0 ${sidePanel === 'polls' ? 'bg-teal-600' : 'bg-gray-700 hover:bg-gray-600'}`}>
        <BarChart2 className="w-5 h-5" />
      </button>
      <button onClick={() => onTogglePanel('whiteboard')} aria-label="باز کردن وایت‌بورد" aria-pressed={sidePanel === 'whiteboard'}
        className={`w-12 h-12 rounded-full flex items-center justify-center transition-all shadow-lg flex-shrink-0 ${sidePanel === 'whiteboard' ? 'bg-teal-600' : 'bg-gray-700 hover:bg-gray-600'}`}>
        <PenTool className="w-5 h-5" />
      </button>
      <button onClick={() => onTogglePanel('settings')} aria-label="تنظیمات" aria-pressed={sidePanel === 'settings'}
        className={`w-12 h-12 rounded-full flex items-center justify-center transition-all shadow-lg flex-shrink-0 ${sidePanel === 'settings' ? 'bg-teal-600' : 'bg-gray-700 hover:bg-gray-600'}`}>
        <SlidersHorizontal className="w-5 h-5" />
      </button>
      <button onClick={() => onTogglePanel('diagnostics')} aria-label="کیفیت اتصال" aria-pressed={sidePanel === 'diagnostics'}
        className={`w-12 h-12 rounded-full flex items-center justify-center transition-all shadow-lg flex-shrink-0 ${sidePanel === 'diagnostics' ? 'bg-teal-600' : 'bg-gray-700 hover:bg-gray-600'}`}>
        <Activity className="w-5 h-5" />
      </button>
      <div className="w-px h-8 bg-gray-700 flex-shrink-0" />
      <button onClick={onToggleSpeakerMute} aria-label={isSpeakerMuted ? 'فعال کردن صدای اسپیکر' : 'قطع صدای اسپیکر'} aria-pressed={isSpeakerMuted}
        className={`w-12 h-12 rounded-full flex items-center justify-center transition-all shadow-lg flex-shrink-0 ${isSpeakerMuted ? 'bg-red-600 hover:bg-red-500' : 'bg-gray-700 hover:bg-gray-600'}`}>
        {isSpeakerMuted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
      </button>
      {canMuteAll && (
        <button onClick={onMuteAll} aria-label="قطع میکروفون همه شرکت‌کنندگان"
          className="w-12 h-12 rounded-full bg-amber-700 hover:bg-amber-600 flex items-center justify-center transition-all shadow-lg flex-shrink-0">
          <ShieldAlert className="w-5 h-5" />
        </button>
      )}
      <button onClick={onLeave} aria-label="ترک یا پایان جلسه"
        className="w-14 h-12 rounded-full bg-red-600 hover:bg-red-500 flex items-center justify-center transition-all shadow-lg flex-shrink-0">
        <PhoneOff className="w-5 h-5" />
      </button>
    </div>
  );
}
