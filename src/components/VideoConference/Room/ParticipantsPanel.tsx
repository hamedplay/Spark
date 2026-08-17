import { Hand, Crown, MicOff, VideoOff, ShieldCheck, ArrowRightLeft, UserX, Pin, Clock, Mic as Mic2, ShieldOff } from 'lucide-react';
import { VideoTile, QualityDot } from '../VideoTile';
import { PendingApprovalsList } from '../ApprovalGate';
import type { PendingApproval } from '../ApprovalGate';
import { BanList } from '../BanList';
import type { ConferenceParticipant } from '../types';
import type { RoleType, Permission } from './roleConstants';
import { ROLE_LABELS, ROLE_COLORS } from './roleConstants';
import type { TileData } from './VideoArea';

export function ParticipantsPanel(props: {
  allTiles: TileData[];
  participants: ConferenceParticipant[];
  myRole: RoleType;
  isHost: boolean;
  hostId: string;
  myPeerId: string;
  currentUserId: string;
  currentUserName: string;
  pinnedPeerId: string | null;
  setPinnedPeerId: React.Dispatch<React.SetStateAction<string | null>>;
  sortedQueue: { peerId: string; name: string; time: number }[];
  pendingApprovals: PendingApproval[];
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  peersSize: number;
  showBanList: boolean;
  setShowBanList: React.Dispatch<React.SetStateAction<boolean>>;
  checkPermission: (p: Permission) => boolean;
  muteAll: () => void;
  lowerHand: (peerId: string) => void;
  changeRole: (peerId: string, userId: string, displayName: string, newRole: RoleType) => void;
  transferHost: (peerId: string, userId: string, name: string) => void;
  setKickConfirm: (d: { peerId: string; userId: string; displayName: string } | null) => void;
  setPendingBan: (d: { durationMinutes: number | null; label: string } | null) => void;
  setBanReason: (v: string) => void;
  roleDropdown: string | null;
  setRoleDropdown: React.Dispatch<React.SetStateAction<string | null>>;
  limitEditor: string | null;
  setLimitEditor: React.Dispatch<React.SetStateAction<string | null>>;
  limitInputs: Record<string, string>;
  setLimitInputs: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  sendSignalRef: React.MutableRefObject<(to: string | null, type: string, data: object) => void>;
  speakingLimitEnabled: boolean;
  tileReactions: Map<string, string>;
  roomId: string;
}) {
  const {
    allTiles, participants, myRole, isHost, hostId, myPeerId, currentUserId, currentUserName,
    pinnedPeerId, setPinnedPeerId, sortedQueue, pendingApprovals, onApprove, onReject,
    peersSize, showBanList, setShowBanList, checkPermission, muteAll, lowerHand, changeRole, transferHost,
    setKickConfirm, setPendingBan, setBanReason, roleDropdown, setRoleDropdown, limitEditor, setLimitEditor, limitInputs, setLimitInputs, sendSignalRef, speakingLimitEnabled, tileReactions, roomId,
  } = props;

  return (
    <div className="flex-1 overflow-y-auto p-2 space-y-2 min-h-0">
      {/* Hand raise queue — host/admin/moderator only */}
      {checkPermission('lower_hand') && sortedQueue.length > 0 && (
        <div className="p-2 bg-yellow-900/20 rounded-xl border border-yellow-700/40">
          <p className="text-xs font-semibold text-yellow-400 flex items-center gap-1.5 mb-1.5">
            <Hand className="w-3 h-3" />صف دست‌بالاها ({sortedQueue.length})
          </p>
          {sortedQueue.map((entry, i) => (
            <div key={entry.peerId} className="flex items-center gap-2 py-1">
              <span className="w-4 h-4 rounded-full bg-yellow-600/40 text-yellow-300 text-[10px] flex items-center justify-center font-bold flex-shrink-0">{i + 1}</span>
              <span className="text-sm text-gray-200 flex-1 truncate">{entry.name}</span>
              <span className="text-xs text-gray-500 flex-shrink-0">{Math.round((Date.now() - entry.time) / 1000)}ث پیش</span>
              <button onClick={() => lowerHand(entry.peerId)}
                title="پایین آوردن دست"
                aria-label={`پایین آوردن دست ${entry.name}`}
                className="p-1 rounded-lg bg-yellow-900/40 hover:bg-yellow-900/70 text-yellow-400 transition-colors flex-shrink-0">
                <Hand className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Pending approvals — host/admin only */}
      <PendingApprovalsList
        approvals={pendingApprovals}
        onApprove={onApprove}
        onReject={onReject}
      />

      {/* Host tools */}
      {(checkPermission('mute_all') || checkPermission('kick') || checkPermission('ban')) && (
        <div className="p-2 bg-gray-800/60 rounded-xl space-y-1.5 border border-gray-700">
          <p className="text-xs font-semibold text-amber-400 flex items-center gap-1.5">
            <Crown className="w-3 h-3" />ابزار مدیریت
          </p>
          {checkPermission('mute_all') && peersSize > 0 && (
            <button onClick={muteAll}
              className="w-full flex items-center gap-2 px-3 py-2 bg-gray-700 hover:bg-amber-900/40 text-gray-200 hover:text-amber-300 rounded-lg text-xs transition-colors">
              <Mic2 className="w-3.5 h-3.5" />قطع میکروفون همه
            </button>
          )}
          {checkPermission('ban') && (
            <button onClick={() => setShowBanList(v => !v)}
              className="w-full flex items-center gap-2 px-3 py-2 bg-gray-700 hover:bg-red-900/30 text-gray-200 hover:text-red-300 rounded-lg text-xs transition-colors">
              <ShieldOff className="w-3.5 h-3.5" />
              {showBanList ? 'بستن لیست مسدودشدگان' : 'لیست مسدودشدگان'}
            </button>
          )}
          {showBanList && <BanList roomId={roomId} />}
        </div>
      )}

      {/* Participant list */}
      {(() => {
        const roleMap = new Map(participants.map(p => [p.user_id, p.role as RoleType]));
        return allTiles.map(t => {
          const dbRole = t.isLocal ? myRole : (roleMap.get(t.userId) || 'member');
          const effectiveRole: RoleType = t.isHost ? 'host' : dbRole;
          const assignableRoles: RoleType[] = effectiveRole === 'host' ? [] :
            (checkPermission('manage_roles') ? (['admin','moderator','member','guest'] as RoleType[]).filter(r => r !== effectiveRole) : []);
          return (
          <div key={t.peerId} className="flex items-center gap-2 p-2 bg-gray-800 rounded-xl group relative">
            <div className="w-8 h-8 rounded-full bg-teal-700 flex items-center justify-center text-xs font-bold flex-shrink-0">
              {t.displayName[0]?.toUpperCase() || '?'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{t.isLocal ? `${t.displayName} (شما)` : t.displayName}</p>
              <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                <QualityDot quality={t.networkQuality} />
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${ROLE_COLORS[effectiveRole]}`}>
                  {effectiveRole === 'host' && <Crown className="w-2.5 h-2.5 inline mr-0.5" />}
                  {ROLE_LABELS[effectiveRole]}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              {t.isMuted && <MicOff className="w-3 h-3 text-red-400" />}
              {t.isVideoOff && <VideoOff className="w-3 h-3 text-red-400" />}
              {t.isHandRaised && <Hand className="w-3.5 h-3.5 text-yellow-400 animate-bounce" />}
              {/* Host lower hand */}
              {checkPermission('lower_hand') && !t.isLocal && t.isHandRaised && (
                <button onClick={() => lowerHand(t.peerId)}
                  title="پایین آوردن دست"
                  className="p-1 rounded-lg hover:bg-yellow-900/40 text-yellow-500 hover:text-yellow-300 transition-colors">
                  <Hand className="w-3 h-3" />
                </button>
              )}
              {/* Role change */}
              {assignableRoles.length > 0 && !t.isLocal && !t.isHost && (
                <div className="relative">
                  <button
                    onClick={() => setRoleDropdown(d => d === t.peerId ? null : t.peerId)}
                    title="تغییر نقش"
                    className="p-1 rounded-lg hover:bg-blue-900/40 text-gray-600 hover:text-blue-400 transition-colors opacity-0 group-hover:opacity-100">
                    <ShieldCheck className="w-3.5 h-3.5" />
                  </button>
                  {roleDropdown === t.peerId && (
                    <div className="absolute left-0 top-6 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl z-50 py-1 min-w-[100px]" onMouseDown={e => e.stopPropagation()}>
                      {assignableRoles.map(r => (
                        <button key={r} onClick={() => changeRole(t.peerId, t.userId, t.displayName, r)}
                          className={`w-full text-right px-3 py-1.5 text-xs hover:bg-gray-800 transition-colors ${ROLE_COLORS[r]}`}>
                          {ROLE_LABELS[r]}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {/* Transfer host */}
              {checkPermission('transfer_host') && !t.isLocal && !t.isHost && (
                <button onClick={() => transferHost(t.peerId, t.userId, t.displayName)}
                  title="انتقال میزبانی"
                  aria-label={`انتقال میزبانی به ${t.displayName}`}
                  className="p-1 rounded-lg bg-transparent hover:bg-amber-900/40 text-gray-600 hover:text-amber-400 transition-colors opacity-0 group-hover:opacity-100">
                  <ArrowRightLeft className="w-3 h-3" />
                </button>
              )}
              {/* Kick */}
              {checkPermission('kick') && !t.isLocal && !t.isHost && (
                <button onClick={() => { setKickConfirm({ peerId: t.peerId, userId: t.userId, displayName: t.displayName }); setPendingBan(null); setBanReason(''); }}
                  title="خارج کردن از جلسه"
                  className="p-1 rounded-lg bg-red-900/0 hover:bg-red-900/40 text-gray-600 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100">
                  <UserX className="w-3.5 h-3.5" />
                </button>
              )}
              {/* Per-user speaking limit */}
              {checkPermission('mute_all') && speakingLimitEnabled && !t.isLocal && !t.isHost && (
                <div className="relative">
                  <button
                    onClick={() => {
                      setLimitEditor(d => d === t.peerId ? null : t.peerId);
                      setLimitInputs(prev => ({ ...prev, [t.peerId]: prev[t.peerId] ?? '60' }));
                    }}
                    title="تنظیم محدودیت زمان صحبت"
                    className="p-1 rounded-lg hover:bg-teal-900/40 text-gray-600 hover:text-teal-400 transition-colors opacity-0 group-hover:opacity-100">
                    <Clock className="w-3.5 h-3.5" />
                  </button>
                  {limitEditor === t.peerId && (
                    <div className="absolute left-0 top-7 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl z-50 p-2 w-40" onMouseDown={e => e.stopPropagation()}>
                      <p className="text-[10px] text-gray-400 mb-1.5">محدودیت صحبت (ثانیه)</p>
                      <div className="flex gap-1">
                        <input
                          type="number"
                          min={10}
                          max={600}
                          value={limitInputs[t.peerId] ?? '60'}
                          onChange={e => setLimitInputs(prev => ({ ...prev, [t.peerId]: e.target.value }))}
                          className="flex-1 bg-gray-800 text-white text-xs rounded-lg px-2 py-1 outline-none focus:ring-1 focus:ring-teal-600 w-0"
                        />
                        <button
                          onClick={() => {
                            const secs = Math.max(10, Math.min(600, Number(limitInputs[t.peerId]) || 60));
                            sendSignalRef.current(t.peerId, 'speaking_limit_change', { targetUserId: t.userId, limitSecs: secs });
                            setLimitEditor(null);
                            toast.success(`محدودیت صحبت ${t.displayName}: ${secs}ث`);
                          }}
                          className="px-2 py-1 bg-teal-600 hover:bg-teal-500 rounded-lg text-xs text-white transition-colors flex-shrink-0"
                        >
                          ثبت
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {/* Pin */}
              {!t.isLocal && (
                <button onClick={() => setPinnedPeerId(p => p === t.peerId ? null : t.peerId)}
                  title="پین کردن"
                  className={`p-1 rounded-lg transition-colors opacity-0 group-hover:opacity-100 ${pinnedPeerId === t.peerId ? 'text-teal-400 bg-teal-900/40 opacity-100' : 'text-gray-600 hover:text-teal-400 hover:bg-teal-900/20'}`}>
                  <Pin className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
          );
        });
      })()}
      {participants.length > allTiles.length && (
        <p className="text-xs text-gray-500 text-center py-1">{participants.length} نفر در جلسه</p>
      )}
    </div>
  );
}

