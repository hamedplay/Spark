import { SlidersHorizontal, Activity, X } from 'lucide-react';
import type { ConferenceMessage, PeerConnection, Reaction, SidePanel, ConferenceParticipant, ConferenceRoom } from '../types';
import type { PeerDiagnostics } from '../../../lib/webrtcDiagnostics';
import type { PendingApproval } from '../ApprovalGate';
import type { KickConfirmData, PendingBanData } from '../Room/KickBanModal';
import type { RoleType, Permission } from '../Room/roleConstants';
import type { VideoQuality } from '../SettingsPanel';
import { ChatPanel } from '../ChatPanel';
import { ParticipantsPanel } from '../Room/ParticipantsPanel';
import { PollPanel } from '../PollPanel';
import { Whiteboard } from '../Whiteboard';
import { SettingsPanel } from '../SettingsPanel';
import { DiagnosticsPanel } from '../Room/DiagnosticsPanel';
import type { TileData } from '../Room/VideoArea';

type QualityColor = { excellent: string; good: string; fair: string; poor: string };

interface SidePanelContainerProps {
  sidePanel: SidePanel;
  setSidePanel: (v: SidePanel) => void;
  togglePanel: (p: SidePanel) => void;
  isMobile: boolean;
  room: ConferenceRoom;
  // chat
  messages: ConferenceMessage[];
  chatEnabled: boolean;
  canToggleChat: boolean;
  onToggleChat: () => void;
  sendSignalStable: (to: string | null, type: string, data: object) => void;
  currentUserId: string;
  currentUserName: string;
  onOwnMessage: (msg: ConferenceMessage) => void;
  // participants
  allTiles: TileData[];
  participants: ConferenceParticipant[];
  myRole: RoleType;
  isHost: boolean;
  hostId: string;
  myPeerId: string;
  currentUserNameForPanel: string;
  pinnedPeerId: string | null;
  setPinnedPeerId: (v: string | null) => void;
  sortedQueue: { peerId: string; name: string; time: number }[];
  pendingApprovals: PendingApproval[];
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  peersSize: number;
  showBanList: boolean;
  setShowBanList: (v: boolean) => void;
  checkPermission: (perm: Permission) => boolean;
  muteAll: () => void;
  lowerHand: (peerId: string) => void;
  changeRole: (peerId: string, userId: string, name: string, role: RoleType) => void;
  transferHost: (peerId: string, userId: string, name: string) => void;
  setKickConfirm: (v: KickConfirmData | null) => void;
  setPendingBan: (v: PendingBanData | null) => void;
  setBanReason: (v: string) => void;
  roleDropdown: string | null;
  setRoleDropdown: (v: string | null) => void;
  limitEditor: string | null;
  setLimitEditor: (v: string | null) => void;
  limitInputs: Record<string, string>;
  setLimitInputs: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  sendSignalRef: React.MutableRefObject<(to: string | null, type: string, data: object) => void>;
  speakingLimitEnabled: boolean;
  tileReactions: Map<string, string>;
  roomId: string;
  // settings
  videoQuality: VideoQuality;
  dataSaverMode: boolean;
  applyingVideoConstraints: boolean;
  onChangeQuality: (q: VideoQuality) => void;
  onToggleDataSaver: () => void;
  onToggleSpeakingLimit: () => void;
  // diagnostics
  myQuality: PeerConnection['networkQuality'];
  peers: Map<string, PeerConnection>;
  peerDiagnostics: Map<string, PeerDiagnostics>;
  qualityColor: QualityColor;
}

export function SidePanelContainer(props: SidePanelContainerProps) {
  const {
    sidePanel, setSidePanel, togglePanel, isMobile, room,
    messages, chatEnabled, canToggleChat, onToggleChat, sendSignalStable,
    currentUserId, currentUserName, onOwnMessage,
    allTiles, participants, myRole, isHost, hostId, myPeerId,
    pinnedPeerId, setPinnedPeerId, sortedQueue, pendingApprovals,
    onApprove, onReject, peersSize, showBanList, setShowBanList,
    checkPermission, muteAll, lowerHand, changeRole, transferHost,
    setKickConfirm, setPendingBan, setBanReason,
    roleDropdown, setRoleDropdown, limitEditor, setLimitEditor,
    limitInputs, setLimitInputs, sendSignalRef, speakingLimitEnabled,
    tileReactions, roomId,
    videoQuality, dataSaverMode, applyingVideoConstraints,
    onChangeQuality, onToggleDataSaver, onToggleSpeakingLimit,
    myQuality, peers, peerDiagnostics, qualityColor,
  } = props;

  if (!sidePanel) return null;

  return (
    <>
      {isMobile && (
        <div className="absolute inset-0 bg-black/60 z-30" onClick={() => setSidePanel(null)} />
      )}
      <div className={`
        bg-gray-900 border-gray-800 flex flex-col z-40
        ${isMobile
          ? 'absolute bottom-0 left-0 right-0 h-[70vh] rounded-t-2xl border-t conf-panel-mobile'
          : 'w-64 md:w-72 flex-shrink-0 border-r relative'
        }
      `}>
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
              if (p === 'chat') return room.allow_chat;
              if (p === 'whiteboard') return true;
              if (p === 'polls') return true;
              return true;
            }).map(p => (
                <button key={p!} onClick={() => togglePanel(p)}
                  className={`flex-1 py-2.5 text-xs font-medium transition-colors ${sidePanel === p ? 'text-teal-400 border-b-2 border-teal-400' : 'text-gray-500 hover:text-gray-300'}`}>
                  {p === 'chat' ? 'چت' : p === 'participants' ? (
                    <span className="flex items-center justify-center gap-1">
                      افراد
                      {sortedQueue.length > 0 && (
                        <span className="w-4 h-4 rounded-full bg-yellow-500 text-black text-[10px] flex items-center justify-center font-bold">
                          {sortedQueue.length}
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

        {sidePanel === 'chat' && (
          <ChatPanel
            roomId={room.id}
            currentUserId={currentUserId}
            currentUserName={currentUserName}
            messages={messages}
            chatEnabled={chatEnabled}
            canToggleChat={canToggleChat}
            onToggleChat={onToggleChat}
            sendSignal={sendSignalStable}
            onOwnMessage={onOwnMessage}
          />
        )}

        {sidePanel === 'participants' && (
          <ParticipantsPanel
            allTiles={allTiles}
            participants={participants}
            myRole={myRole}
            isHost={isHost}
            hostId={hostId}
            myPeerId={myPeerId}
            currentUserId={currentUserId}
            currentUserName={currentUserName}
            pinnedPeerId={pinnedPeerId}
            setPinnedPeerId={setPinnedPeerId}
            sortedQueue={sortedQueue}
            pendingApprovals={pendingApprovals}
            onApprove={onApprove}
            onReject={onReject}
            peersSize={peersSize}
            showBanList={showBanList}
            setShowBanList={setShowBanList}
            checkPermission={checkPermission}
            muteAll={muteAll}
            lowerHand={lowerHand}
            changeRole={changeRole}
            transferHost={transferHost}
            setKickConfirm={setKickConfirm}
            setPendingBan={setPendingBan}
            setBanReason={setBanReason}
            roleDropdown={roleDropdown}
            setRoleDropdown={setRoleDropdown}
            limitEditor={limitEditor}
            setLimitEditor={setLimitEditor}
            limitInputs={limitInputs}
            setLimitInputs={setLimitInputs}
            sendSignalRef={sendSignalRef}
            speakingLimitEnabled={speakingLimitEnabled}
            tileReactions={tileReactions}
            roomId={room.id}
          />
        )}

        {sidePanel === 'polls' && <PollPanel roomId={room.id} userId={currentUserId} isHost={checkPermission('manage_polls')} />}
        {sidePanel === 'whiteboard' && (
          <div className="flex-1 overflow-hidden min-h-0">
            <Whiteboard roomId={room.id} userId={currentUserId} isHost={checkPermission('toggle_whiteboard')} />
          </div>
        )}
        {sidePanel === 'settings' && (
          <>
            <SettingsPanel
              videoQuality={videoQuality}
              dataSaverMode={dataSaverMode}
              isApplying={applyingVideoConstraints}
              onChangeQuality={onChangeQuality}
              onToggleDataSaver={onToggleDataSaver}
            />
            {/* Speaking limit toggle — host/admin only */}
            {checkPermission('mute_all') && (
              <div className="px-4 py-3 border-t border-gray-800 flex items-center justify-between gap-3 flex-shrink-0">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-200">محدودیت زمان صحبت</p>
                  <p className="text-xs text-gray-500 mt-0.5">محدودیت پیش‌فرض ۶۰ ثانیه — قابل تنظیم برای هر کاربر</p>
                </div>
                <button
                  onClick={onToggleSpeakingLimit}
                  aria-pressed={speakingLimitEnabled}
                  className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${speakingLimitEnabled ? 'bg-teal-600' : 'bg-gray-700'}`}
                >
                  <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${speakingLimitEnabled ? 'right-0.5' : 'left-0.5'}`} />
                </button>
              </div>
            )}
          </>
        )}

        {sidePanel === 'diagnostics' && (
          <DiagnosticsPanel
            myQuality={myQuality}
            peers={peers}
            peerDiagnostics={peerDiagnostics}
            qualityColor={qualityColor}
          />
        )}
      </div>
    </>
  );
}
