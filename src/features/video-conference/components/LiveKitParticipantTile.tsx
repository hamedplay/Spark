import { useEffect, useRef, useState } from 'react';
import {
  Expand,
  MicOff,
  PictureInPicture2,
  Pin,
  PinOff,
  Star,
  UserRound,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { Track } from 'livekit-client';

type ParticipantLike = any;

function attachPublication(
  publication: any,
  element: HTMLMediaElement | null,
) {
  const track = publication?.track;
  if (!track || !element) return () => {};
  track.attach(element);
  return () => {
    try {
      track.detach(element);
    } catch {
      // Best-effort detach.
    }
  };
}

export function LiveKitParticipantTile({
  participant,
  active,
  local = false,
  featured = false,
  pinned = false,
  spotlighted = false,
  preferScreenShare = false,
  speakerMuted = false,
  onTogglePin,
}: {
  participant: ParticipantLike;
  active: boolean;
  local?: boolean;
  featured?: boolean;
  pinned?: boolean;
  spotlighted?: boolean;
  preferScreenShare?: boolean;
  speakerMuted?: boolean;
  onTogglePin?: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const screenAudioRef = useRef<HTMLAudioElement>(null);
  const [zoom, setZoom] = useState(1);

  const cameraPublication = participant?.getTrackPublication?.(
    Track.Source.Camera,
  );
  const screenPublication = participant?.getTrackPublication?.(
    Track.Source.ScreenShare,
  );
  const microphonePublication = participant?.getTrackPublication?.(
    Track.Source.Microphone,
  );
  const screenAudioPublication = participant?.getTrackPublication?.(
    Track.Source.ScreenShareAudio,
  );

  const hasScreenShare = Boolean(
    screenPublication?.track && !screenPublication.isMuted,
  );
  const videoPublication = (
    preferScreenShare && hasScreenShare
      ? screenPublication
      : cameraPublication
  );
  const renderingScreenShare = videoPublication === screenPublication;
  const mirrorLocalCamera = local && !renderingScreenShare;

  const displayName =
    participant?.name || (local ? 'شما' : 'شرکت‌کننده');
  const videoMuted = !videoPublication || videoPublication.isMuted;
  const microphoneMuted =
    !microphonePublication || microphonePublication.isMuted;

  useEffect(
    () => attachPublication(videoPublication, videoRef.current),
    [videoPublication, videoPublication?.track],
  );

  useEffect(
    () => local
      ? undefined
      : attachPublication(
        microphonePublication,
        audioRef.current,
      ),
    [local, microphonePublication, microphonePublication?.track],
  );

  useEffect(
    () => local
      ? undefined
      : attachPublication(
        screenAudioPublication,
        screenAudioRef.current,
      ),
    [local, screenAudioPublication, screenAudioPublication?.track],
  );

  useEffect(() => {
    setZoom(1);
  }, [participant?.identity, renderingScreenShare]);

  const requestFullscreen = async () => {
    const element = rootRef.current;
    if (!element?.requestFullscreen) return;
    try {
      await element.requestFullscreen();
    } catch (error) {
      console.error('[VideoConference] fullscreen failed', error);
    }
  };

  const togglePictureInPicture = async () => {
    const video = videoRef.current;
    if (
      !video
      || !document.pictureInPictureEnabled
      || typeof video.requestPictureInPicture !== 'function'
    ) return;

    try {
      if (document.pictureInPictureElement === video) {
        await document.exitPictureInPicture();
      } else {
        await video.requestPictureInPicture();
      }
    } catch (error) {
      console.error('[VideoConference] picture-in-picture failed', error);
    }
  };

  const zoomOut = () => setZoom((value) => Math.max(1, value - 0.25));
  const zoomIn = () => setZoom((value) => Math.min(2, value + 0.25));

  return (
    <div
      ref={rootRef}
      className={
        `relative min-h-0 overflow-hidden rounded-2xl bg-slate-900 shadow-sm ring-2 transition `
        + (featured ? 'lg:col-span-2 lg:row-span-2 ' : '')
        + (spotlighted
          ? 'ring-amber-400'
          : active
            ? 'ring-emerald-400'
            : pinned
              ? 'ring-sky-400'
              : 'ring-transparent')
      }
    >
      {videoMuted ? (
        <div className="flex h-full min-h-[160px] items-center justify-center bg-slate-800 text-slate-300">
          <div className="flex flex-col items-center gap-3">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-700">
              <UserRound className="h-8 w-8" />
            </div>
            <span className="max-w-[18rem] truncate px-3 text-sm font-semibold">
              {displayName}
            </span>
          </div>
        </div>
      ) : (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={local}
          className={
            `h-full min-h-[160px] w-full transition-transform duration-200 `
            + (renderingScreenShare ? 'object-contain bg-black' : 'object-cover')
          }
          style={{ transform: `scaleX(${mirrorLocalCamera ? -1 : 1}) scale(${zoom})` }}
        />
      )}

      {!local && (
        <>
          <audio ref={audioRef} autoPlay muted={speakerMuted} />
          <audio
            ref={screenAudioRef}
            autoPlay
            muted={speakerMuted}
          />
        </>
      )}

      <div className="absolute left-2 top-2 z-10 flex flex-wrap gap-1">
        {onTogglePin && (
          <button
            type="button"
            onClick={onTogglePin}
            className={
              `flex h-8 w-8 items-center justify-center rounded-full border border-white/10 `
              + (pinned
                ? 'bg-sky-500 text-white'
                : 'bg-black/45 text-slate-200 hover:bg-black/70')
            }
            aria-label={pinned ? 'برداشتن سنجاق' : 'سنجاق کردن تصویر'}
            aria-pressed={pinned}
          >
            {pinned
              ? <PinOff className="h-4 w-4" />
              : <Pin className="h-4 w-4" />}
          </button>
        )}

        <button
          type="button"
          onClick={() => void requestFullscreen()}
          className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-black/45 text-slate-200 hover:bg-black/70"
          aria-label="نمایش تمام‌صفحه"
        >
          <Expand className="h-4 w-4" />
        </button>

        {!videoMuted && document.pictureInPictureEnabled && (
          <button
            type="button"
            onClick={() => void togglePictureInPicture()}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-black/45 text-slate-200 hover:bg-black/70"
            aria-label="تصویر در تصویر"
          >
            <PictureInPicture2 className="h-4 w-4" />
          </button>
        )}
      </div>

      {!videoMuted && (
        <div className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded-full border border-white/10 bg-black/45 p-1">
          <button
            type="button"
            onClick={zoomOut}
            disabled={zoom <= 1}
            className="flex h-7 w-7 items-center justify-center rounded-full disabled:opacity-40"
            aria-label="کاهش بزرگ‌نمایی"
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
          <span className="min-w-9 text-center text-[10px] font-bold text-white">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            onClick={zoomIn}
            disabled={zoom >= 2}
            className="flex h-7 w-7 items-center justify-center rounded-full disabled:opacity-40"
            aria-label="افزایش بزرگ‌نمایی"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {spotlighted && (
        <div className="absolute bottom-10 right-2 z-10 flex items-center gap-1 rounded-full border border-amber-300/30 bg-amber-400/90 px-2 py-1 text-[10px] font-bold text-slate-950 shadow">
          <Star className="h-3 w-3 fill-current" />
          Spotlight
        </div>
      )}

      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/75 to-transparent px-3 pb-2 pt-8 text-white">
        <span className="max-w-[75%] truncate text-xs font-semibold">
          {displayName}
          {local ? ' (شما)' : ''}
          {renderingScreenShare ? ' · اشتراک صفحه' : ''}
        </span>
        {microphoneMuted && (
          <MicOff className="h-4 w-4" aria-label="میکروفون خاموش" />
        )}
      </div>
    </div>
  );
}
