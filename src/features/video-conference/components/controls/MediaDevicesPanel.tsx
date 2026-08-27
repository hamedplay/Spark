import type { ChangeEvent } from 'react';
import { MicOff, MoreVertical, Video } from 'lucide-react';
import type { MediaDeviceOption } from '../../types/conference.types';

interface Props {
  audioInputs: MediaDeviceOption[];
  videoInputs: MediaDeviceOption[];
  audioOutputs: MediaDeviceOption[];
  selectedMic: string;
  selectedCamera: string;
  selectedSpeaker: string;
  onSwitchDevice: (kind: MediaDeviceKind, deviceId: string) => Promise<void>;
}

export function MediaDevicesPanel({
  audioInputs,
  videoInputs,
  audioOutputs,
  selectedMic,
  selectedCamera,
  selectedSpeaker,
  onSwitchDevice,
}: Props) {
  return (
    <div className="space-y-3 p-4 text-xs">
      <label className="block"><span className="mb-1.5 flex items-center gap-2 font-bold"><MicOff className="h-4 w-4" /> میکروفون</span><select value={selectedMic} onChange={(event: ChangeEvent<HTMLSelectElement>) => void onSwitchDevice('audioinput', event.target.value)} className="min-h-11 w-full rounded-xl border border-white/10 bg-slate-950 px-3"><option value="">انتخاب…</option>{audioInputs.map((device) => <option key={device.deviceId} value={device.deviceId}>{device.label}</option>)}</select></label>
      <label className="block"><span className="mb-1.5 flex items-center gap-2 font-bold"><Video className="h-4 w-4" /> دوربین</span><select value={selectedCamera} onChange={(event: ChangeEvent<HTMLSelectElement>) => void onSwitchDevice('videoinput', event.target.value)} className="min-h-11 w-full rounded-xl border border-white/10 bg-slate-950 px-3"><option value="">انتخاب…</option>{videoInputs.map((device) => <option key={device.deviceId} value={device.deviceId}>{device.label}</option>)}</select></label>
      {audioOutputs.length > 0 && <label className="block"><span className="mb-1.5 flex items-center gap-2 font-bold"><MoreVertical className="h-4 w-4" /> خروجی صدا</span><select value={selectedSpeaker} onChange={(event: ChangeEvent<HTMLSelectElement>) => void onSwitchDevice('audiooutput', event.target.value)} className="min-h-11 w-full rounded-xl border border-white/10 bg-slate-950 px-3"><option value="">انتخاب…</option>{audioOutputs.map((device) => <option key={device.deviceId} value={device.deviceId}>{device.label}</option>)}</select></label>}
      <p className="leading-6 text-slate-400">تعویض دستگاه بدون خروج از اتاق انجام می‌شود. انتخاب خروجی صدا فقط در مرورگرهایی نمایش داده می‌شود که آن را پشتیبانی کنند.</p>
    </div>
  );
}
