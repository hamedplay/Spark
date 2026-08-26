import { useEffect, useRef } from 'react';
import { MicOff, UserRound } from 'lucide-react';
import { Track } from 'livekit-client';

type ParticipantLike = any;

function attachPublication(publication: any, element: HTMLMediaElement | null) {
  const track = publication?.track;
  if (!track || !element) return () => {};
  track.attach(element);
  return () => {
    try { track.detach(element); } catch { /* best-effort detach */ }
  };
}

export function LiveKitParticipantTile({ participant, active, local = false }: { participant: ParticipantLike; active: boolean; local?: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  const cameraPublication = participant?.getTrackPublication?.(Track.Source.Camera);
  const microphonePublication = participant?.getTrackPublication?.(Track.Source.Microphone);
  const displayName = participant?.name || (local ? 'شما' : 'شرکت‌کننده');
  const cameraMuted = !cameraPublication || cameraPublication.isMuted;
  const microphoneMuted = !microphonePublication || microphonePublication.isMuted;

  useEffect(() => attachPublication(cameraPublication, videoRef.current), [cameraPublication, cameraPublication?.track]);
  useEffect(() => local ? undefined : attachPublication(microphonePublication, audioRef.current), [local, microphonePublication, microphonePublication?.track]);

  return (
    <div className={`relative min-h-0 overflow-hidden rounded-2xl bg-slate-900 shadow-sm ring-2 transition ${active ? 'ring-emerald-400' : 'ring-transparent'}`}>
      {cameraMuted ? (
        <div className="flex h-full min-h-[160px] items-center justify-center bg-slate-800 text-slate-300">
          <div className="flex flex-col items-center gap-3">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-700"><UserRound className="h-8 w-8" /></div>
            <span className="max-w-[18rem] truncate px-3 text-sm font-semibold">{displayName}</span>
          </div>
        </div>
      ) : (
        <video ref={videoRef} autoPlay playsInline muted={local} className="h-full min-h-[160px] w-full object-cover" />
      )}
      {!local && <audio ref={audioRef} autoPlay />}
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/75 to-transparent px-3 pb-2 pt-8 text-white">
        <span className="max-w-[75%] truncate text-xs font-semibold">{displayName}{local ? ' (شما)' : ''}</span>
        {microphoneMuted && <MicOff className="h-4 w-4" aria-label="میکروفون خاموش" />}
      </div>
    </div>
  );
}
