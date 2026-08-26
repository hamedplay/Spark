import { Activity } from 'lucide-react';
import type { PeerConnection } from '../types';
import type { PeerDiagnostics } from '../../../lib/webrtcDiagnostics';

export function DiagnosticsPanel(props: {
  myQuality: PeerConnection['networkQuality'];
  peers: Map<string, PeerConnection>;
  peerDiagnostics: Map<string, PeerDiagnostics>;
  qualityColor: Record<string, string>;
}) {
  const { myQuality, peers, peerDiagnostics, qualityColor } = props;

  return (
    <div className="flex-1 overflow-y-auto p-3 min-h-0" dir="rtl">
      {/* Overall quality */}
      <p className="text-[11px] text-gray-500 uppercase tracking-wide mb-2">کیفیت کلی</p>
      <div className={`flex items-center gap-2 px-3 py-2 rounded-xl border mb-4 ${
        myQuality === 'poor' ? 'bg-red-900/20 border-red-700/40' :
        myQuality === 'fair' ? 'bg-amber-900/20 border-amber-700/40' :
        'bg-emerald-900/20 border-emerald-700/40'
      }`}>
        <Activity className={`w-4 h-4 ${qualityColor[myQuality]}`} />
        <span className={`text-sm font-semibold ${qualityColor[myQuality]}`}>
          {{ excellent: 'عالی', good: 'خوب', fair: 'متوسط', poor: 'ضعیف' }[myQuality]}
        </span>
        <span className="text-xs text-gray-500 mr-auto">{peers.size} اتصال</span>
      </div>

      {/* Per-peer stats */}
      <p className="text-[11px] text-gray-500 uppercase tracking-wide mb-2">اتصال‌ها</p>
      <div className="space-y-2">
        {[...peers.values()].map(peer => {
          const diag = peerDiagnostics.get(peer.peerId);
          const isPoor = !!diag && ((diag.rttMs ?? 0) > 400 || (diag.packetLossPct ?? 0) > 5);
          const isFair = !isPoor && !!diag && ((diag.rttMs ?? 0) > 150 || (diag.packetLossPct ?? 0) > 1);
          const qc = isPoor ? 'text-red-400' : isFair ? 'text-amber-400' : 'text-emerald-400';
          return (
            <div key={peer.peerId} className="bg-gray-800 rounded-xl p-2.5 space-y-2">
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${peer.connectionState === 'connected' ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'}`} />
                <span className="text-xs font-medium text-white truncate flex-1">{peer.displayName}</span>
                {diag && (
                  <span className={`text-[10px] font-medium ${qc}`}>
                    {isPoor ? 'ضعیف' : isFair ? 'متوسط' : 'خوب'}
                  </span>
                )}
              </div>
              {diag ? (
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                  <div className="flex justify-between">
                    <span className="text-gray-500">تاخیر</span>
                    <span className={diag.rttMs !== null && diag.rttMs > 400 ? 'text-red-400' : diag.rttMs !== null && diag.rttMs > 150 ? 'text-amber-400' : 'text-gray-200'}>
                      {diag.rttMs !== null ? `${diag.rttMs} ms` : '—'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">افت</span>
                    <span className={diag.packetLossPct !== null && diag.packetLossPct > 5 ? 'text-red-400' : diag.packetLossPct !== null && diag.packetLossPct > 1 ? 'text-amber-400' : 'text-gray-200'}>
                      {diag.packetLossPct !== null ? `${diag.packetLossPct}%` : '—'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">دریافت</span>
                    <span className="text-gray-200">{diag.inboundBitrateKbps !== null ? `${diag.inboundBitrateKbps} k` : '—'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">ارسال</span>
                    <span className="text-gray-200">{diag.outboundBitrateKbps !== null ? `${diag.outboundBitrateKbps} k` : '—'}</span>
                  </div>
                  {diag.selectedCandidatePair && (
                    <div className="col-span-2 flex justify-between">
                      <span className="text-gray-500">مسیر</span>
                      <span className="text-gray-200">
                        {diag.selectedCandidatePair.localType === 'relay' ? 'TURN' : 'P2P'}
                        {' / '}{diag.selectedCandidatePair.protocol?.toUpperCase() ?? '—'}
                      </span>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-[11px] text-gray-600 text-center py-1">در حال جمع‌آوری...</p>
              )}
            </div>
          );
        })}
        {peers.size === 0 && (
          <p className="text-center text-gray-600 text-xs py-6">هنوز کسی در جلسه نیست</p>
        )}
      </div>
      <p className="text-[10px] text-gray-700 text-center mt-4">هر ۵ ثانیه به‌روز می‌شود</p>
    </div>
  );
}
