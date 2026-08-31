import type { ChangeEvent } from 'react';
import { Camera, Gauge, MicOff, MonitorUp, MoreVertical, RotateCcw, Video } from 'lucide-react';
import type {
  ConferenceCameraQuality,
  ConferenceMediaQualityProfile,
  ConferenceScreenShareQuality,
  MediaDeviceOption,
} from '../../types/conference.types';

interface Props {
  audioInputs: MediaDeviceOption[];
  videoInputs: MediaDeviceOption[];
  audioOutputs: MediaDeviceOption[];
  selectedMic: string;
  selectedCamera: string;
  selectedSpeaker: string;
  mediaProfile: ConferenceMediaQualityProfile;
  cameraQuality: ConferenceCameraQuality;
  screenShareQuality: ConferenceScreenShareQuality;
  busy: boolean;
  speakerSelectionSupported: boolean;
  canSwitchCamera: boolean;
  onSwitchDevice: (kind: MediaDeviceKind, deviceId: string) => Promise<void>;
  onSwitchCamera: () => Promise<void>;
  onMediaProfileChange: (profile: ConferenceMediaQualityProfile) => void;
  onCameraQualityChange: (quality: ConferenceCameraQuality) => void;
  onScreenShareQualityChange: (quality: ConferenceScreenShareQuality) => void;
}

export function MediaDevicesPanel({
  audioInputs,
  videoInputs,
  audioOutputs,
  selectedMic,
  selectedCamera,
  selectedSpeaker,
  mediaProfile,
  cameraQuality,
  screenShareQuality,
  busy,
  speakerSelectionSupported,
  canSwitchCamera,
  onSwitchDevice,
  onSwitchCamera,
  onMediaProfileChange,
  onCameraQualityChange,
  onScreenShareQualityChange,
}: Props) {
  return (
    <div className="space-y-3 p-4 text-xs">
      <label className="block">
        <span className="mb-1.5 flex items-center gap-2 font-bold">
          <MicOff className="h-4 w-4" /> میکروفون
        </span>
        <select
          value={selectedMic}
          disabled={busy}
          onChange={(event: ChangeEvent<HTMLSelectElement>) => void onSwitchDevice('audioinput', event.target.value)}
          className="min-h-11 w-full rounded-xl border border-white/10 bg-slate-950 px-3 disabled:opacity-50"
        >
          <option value="">انتخاب…</option>
          {audioInputs.map((device) => (
            <option key={device.deviceId} value={device.deviceId}>
              {device.label}
            </option>
          ))}
        </select>
      </label>
      <div className="space-y-2">
        <label className="block">
          <span className="mb-1.5 flex items-center gap-2 font-bold">
            <Video className="h-4 w-4" /> دوربین
          </span>
          <select
            value={selectedCamera}
            disabled={busy}
            onChange={(event: ChangeEvent<HTMLSelectElement>) => void onSwitchDevice('videoinput', event.target.value)}
            className="min-h-11 w-full rounded-xl border border-white/10 bg-slate-950 px-3 disabled:opacity-50"
          >
            <option value="">انتخاب…</option>
            {videoInputs.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label}
              </option>
            ))}
          </select>
        </label>
        {canSwitchCamera && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void onSwitchCamera()}
            className="flex min-h-10 w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-slate-800 px-3 text-xs font-bold disabled:opacity-50"
          >
            <RotateCcw className="h-4 w-4" />
            تعویض دوربین
          </button>
        )}
      </div>
      {speakerSelectionSupported && audioOutputs.length > 0 ? (
        <label className="block">
          <span className="mb-1.5 flex items-center gap-2 font-bold">
            <MoreVertical className="h-4 w-4" /> خروجی صدا
          </span>
          <select
            value={selectedSpeaker}
            disabled={busy}
            onChange={(event: ChangeEvent<HTMLSelectElement>) => void onSwitchDevice('audiooutput', event.target.value)}
            className="min-h-11 w-full rounded-xl border border-white/10 bg-slate-950 px-3 disabled:opacity-50"
          >
            <option value="">انتخاب…</option>
            {audioOutputs.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <div className="rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-[11px] leading-5 text-slate-400">
          انتخاب خروجی صدا در این مرورگر پشتیبانی نمی‌شود.
        </div>
      )}

      <div className="border-t border-white/10 pt-3">
        <div className="mb-3 flex items-center gap-2 font-bold"><Gauge className="h-4 w-4" /> کیفیت رسانه</div>
        <div className="space-y-3">
          <label className="block">
            <span className="mb-1.5 block font-semibold">پروفایل</span>
            <select
              value={mediaProfile}
              onChange={(event: ChangeEvent<HTMLSelectElement>) => onMediaProfileChange(event.target.value as ConferenceMediaQualityProfile)}
              className="min-h-11 w-full rounded-xl border border-white/10 bg-slate-950 px-3"
            >
              <option value="AUTO">AUTO — خودکار</option>
              <option value="DATA_SAVER">DATA SAVER — مصرف کمتر</option>
              <option value="BALANCED">BALANCED — متعادل</option>
              <option value="HIGH">HIGH — کیفیت بالا</option>
            </select>
          </label>

          <label className="block">
            <span className="mb-1.5 flex items-center gap-2 font-semibold"><Video className="h-4 w-4" /> کیفیت دوربین</span>
            <select
              value={cameraQuality}
              onChange={(event: ChangeEvent<HTMLSelectElement>) => onCameraQualityChange(event.target.value as ConferenceCameraQuality)}
              className="min-h-11 w-full rounded-xl border border-white/10 bg-slate-950 px-3"
            >
              {['180p', '360p', '540p', '720p', '1080p'].map((quality) => (
                <option key={quality} value={quality}>{quality}</option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1.5 flex items-center gap-2 font-semibold"><MonitorUp className="h-4 w-4" /> کیفیت اشتراک صفحه</span>
            <select
              value={screenShareQuality}
              onChange={(event: ChangeEvent<HTMLSelectElement>) => onScreenShareQualityChange(event.target.value as ConferenceScreenShareQuality)}
              className="min-h-11 w-full rounded-xl border border-white/10 bg-slate-950 px-3"
            >
              <option value="720p">720p / 15fps</option>
              <option value="1080p">1080p / 15fps</option>
            </select>
          </label>
        </div>
      </div>

      <p className="leading-6 text-slate-400">
        Adaptive Stream کیفیت دریافتی هر Tile را بر اساس اندازه آن تنظیم می‌کند. Tile فعال یا سنجاق‌شده می‌تواند لایه بالاتر بگیرد؛ Tileهای Grid سقف پایین‌تری دارند. تغییر کیفیت Screen Share از اشتراک بعدی اعمال می‌شود.
      </p>
    </div>
  );
}
