import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Mic, MicOff, Video, VideoOff, Volume2, VolumeX, Loader2,
  RefreshCw, CheckCircle2,
} from 'lucide-react';

const LS_KEY = 'conf_device_prefs';

export interface DevicePrefs {
  audioInputId: string;
  audioOutputId: string;
  videoInputId: string;
}

function loadPrefs(): Partial<DevicePrefs> {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch { return {}; }
}

function savePrefs(p: Partial<DevicePrefs>) {
  try { localStorage.setItem(LS_KEY, JSON.stringify({ ...loadPrefs(), ...p })); } catch {}
}

interface Props {
  onConfirm: (stream: MediaStream, prefs: DevicePrefs) => void;
  submitLabel?: string;
  children?: React.ReactNode;
  submitDisabled?: boolean;
}

export function DeviceSelector({ onConfirm, submitLabel = 'ادامه', children, submitDisabled }: Props) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedAudioInput, setSelectedAudioInput] = useState('');
  const [selectedAudioOutput, setSelectedAudioOutput] = useState('');
  const [selectedVideo, setSelectedVideo] = useState('');

  const [stream, setStream] = useState<MediaStream | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  // isVideoOff tracks the UI toggle state. We always acquire a video track —
  // toggling only sets track.enabled, so re-enabling works after device switch.
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [acquiring, setAcquiring] = useState(false);
  const [permError, setPermError] = useState('');

  const [volume, setVolume] = useState(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number>(0);
  const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);

  const [testingSound, setTestingSound] = useState(false);
  const [soundTestDone, setSoundTestDone] = useState(false);
  // Hidden <audio> element used for speaker routing (setSinkId on AudioContext.destination is not supported)
  const speakerTestRef = useRef<HTMLAudioElement | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  useEffect(() => { streamRef.current = stream; }, [stream]);

  // Prevent cleanup from stopping the stream after the user confirms
  const confirmedRef = useRef(false);

  const audioInputs = devices.filter(d => d.kind === 'audioinput');
  const audioOutputs = devices.filter(d => d.kind === 'audiooutput');
  const videoInputs = devices.filter(d => d.kind === 'videoinput');

  // ── Enumerate devices ──────────────────────────────────────────────────────
  const enumerateDevices = useCallback(async () => {
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      setDevices(list);

      const saved = loadPrefs();
      const hasId = (kind: MediaDeviceKind, id: string) =>
        list.some(d => d.kind === kind && d.deviceId === id);

      setSelectedVideo(prev => {
        if (prev && hasId('videoinput', prev)) return prev;
        if (saved.videoInputId && hasId('videoinput', saved.videoInputId)) return saved.videoInputId;
        return list.find(d => d.kind === 'videoinput')?.deviceId || '';
      });
      setSelectedAudioInput(prev => {
        if (prev && hasId('audioinput', prev)) return prev;
        if (saved.audioInputId && hasId('audioinput', saved.audioInputId)) return saved.audioInputId;
        return list.find(d => d.kind === 'audioinput')?.deviceId || '';
      });
      setSelectedAudioOutput(prev => {
        if (prev && hasId('audiooutput', prev)) return prev;
        if (saved.audioOutputId && hasId('audiooutput', saved.audioOutputId)) return saved.audioOutputId;
        return list.find(d => d.kind === 'audiooutput')?.deviceId || '';
      });
    } catch {}
  }, []);

  // ── Volume meter ───────────────────────────────────────────────────────────
  const stopVolumeMeter = useCallback(() => {
    cancelAnimationFrame(animFrameRef.current);
    micSourceRef.current?.disconnect();
    micSourceRef.current = null;
    analyserRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    setVolume(0);
  }, []);

  const startVolumeMeter = useCallback((s: MediaStream) => {
    stopVolumeMeter();
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      const source = ctx.createMediaStreamSource(s);
      source.connect(analyser);
      audioCtxRef.current = ctx;
      analyserRef.current = analyser;
      micSourceRef.current = source;

      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(data);
        const avg = data.reduce((a, b) => a + b, 0) / data.length;
        setVolume(Math.min(100, Math.round((avg / 128) * 100)));
        animFrameRef.current = requestAnimationFrame(tick);
      };
      animFrameRef.current = requestAnimationFrame(tick);
    } catch {}
  }, [stopVolumeMeter]);

  // ── Acquire stream ─────────────────────────────────────────────────────────
  // Always request both audio and video tracks. isVideoOff is applied via
  // track.enabled after acquisition, so toggling video always works even
  // after a device switch.
  const acquireStream = useCallback(async (videoId: string, audioId: string, currentVideoOff: boolean) => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    stopVolumeMeter();
    setAcquiring(true);
    setPermError('');

    const videoConstraint: MediaTrackConstraints | boolean = videoId
      ? {
          deviceId: { exact: videoId },
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30, max: 30 },
        }
      : { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } };
    const audioConstraint: MediaTrackConstraints | boolean = audioId
      ? {
          deviceId: { exact: audioId },
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 48000,
        }
      : { echoCancellation: true, noiseSuppression: true, autoGainControl: true, sampleRate: 48000 };

    let s: MediaStream | null = null;
    try {
      s = await navigator.mediaDevices.getUserMedia({ video: videoConstraint, audio: audioConstraint });
    } catch (err: any) {
      // Video failed — try audio only
      try {
        s = await navigator.mediaDevices.getUserMedia({ audio: audioConstraint });
      } catch (audioErr: any) {
        let msg = 'دسترسی به دوربین و میکروفن امکان‌پذیر نیست. لطفاً مجوزها را بررسی کنید.';
        const name = err?.name || audioErr?.name;
        if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
          msg = 'مجوز دسترسی رد شد. در تنظیمات مرورگر دسترسی دوربین/میکروفن را فعال کنید.';
        } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
          msg = 'دوربین یا میکروفن یافت نشد. اتصال دستگاه را بررسی کنید.';
        }
        setPermError(msg);
        setAcquiring(false);
        return;
      }
    }

    // Apply current toggle state without re-requesting media
    s.getVideoTracks().forEach(t => { t.enabled = !currentVideoOff; });
    s.getAudioTracks().forEach(t => { t.enabled = !isMuted; });

    setStream(s);
    setAcquiring(false);
    await enumerateDevices();
    startVolumeMeter(s);
  }, [enumerateDevices, startVolumeMeter, stopVolumeMeter, isMuted]);

  // Attach stream to video element
  useEffect(() => {
    if (!videoRef.current || !stream) return;
    videoRef.current.srcObject = stream;
    videoRef.current.play().catch(() => {});
  }, [stream]);

  // Initial acquire + devicechange listener
  useEffect(() => {
    confirmedRef.current = false;
    const saved = loadPrefs();
    enumerateDevices().then(() => {
      acquireStream(saved.videoInputId || '', saved.audioInputId || '', false);
    });

    const handleDeviceChange = () => enumerateDevices();
    navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange);

    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange);
      // Only stop tracks if the user didn't confirm — confirmed streams are
      // kept alive for the conference room.
      if (!confirmedRef.current) {
        streamRef.current?.getTracks().forEach(t => t.stop());
      }
      stopVolumeMeter();
      cancelAnimationFrame(animFrameRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Device change handlers ─────────────────────────────────────────────────
  const handleVideoChange = async (deviceId: string) => {
    setSelectedVideo(deviceId);
    savePrefs({ videoInputId: deviceId });
    await acquireStream(deviceId, selectedAudioInput, isVideoOff);
  };

  const handleAudioInputChange = async (deviceId: string) => {
    setSelectedAudioInput(deviceId);
    savePrefs({ audioInputId: deviceId });
    await acquireStream(selectedVideo, deviceId, isVideoOff);
  };

  const handleAudioOutputChange = (deviceId: string) => {
    setSelectedAudioOutput(deviceId);
    savePrefs({ audioOutputId: deviceId });
    // Route speaker test audio element to selected output
    const el = speakerTestRef.current as any;
    if (el?.setSinkId) el.setSinkId(deviceId).catch(() => {});
    // Also route video element playback if supported
    const vid = videoRef.current as any;
    if (vid?.setSinkId) vid.setSinkId(deviceId).catch(() => {});
  };

  const toggleMute = () => {
    const next = !isMuted;
    stream?.getAudioTracks().forEach(t => { t.enabled = !next; });
    setIsMuted(next);
  };

  const toggleVideo = () => {
    const next = !isVideoOff;
    // Toggle enabled on existing track — no new getUserMedia call needed.
    stream?.getVideoTracks().forEach(t => { t.enabled = !next; });
    setIsVideoOff(next);
  };

  // ── Speaker test — uses a hidden <audio> element so setSinkId works ─────────
  const playTestSound = async () => {
    if (testingSound) return;
    setTestingSound(true);
    setSoundTestDone(false);
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 880;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.8);

      // Route to selected output via the hidden <audio> element if supported
      const el = speakerTestRef.current as any;
      if (el && selectedAudioOutput && el.setSinkId) {
        el.setSinkId(selectedAudioOutput).catch(() => {});
      }

      osc.onended = () => {
        ctx.close();
        setTestingSound(false);
        setSoundTestDone(true);
        setTimeout(() => setSoundTestDone(false), 2000);
      };
    } catch {
      setTestingSound(false);
    }
  };

  // ── Confirm ────────────────────────────────────────────────────────────────
  const handleConfirm = () => {
    if (!stream) return;
    confirmedRef.current = true;
    const prefs: DevicePrefs = {
      audioInputId: selectedAudioInput,
      audioOutputId: selectedAudioOutput,
      videoInputId: selectedVideo,
    };
    savePrefs(prefs);
    onConfirm(stream, prefs);
  };

  const bars = 16;

  return (
    <div className="space-y-4" dir="rtl">
      {/* Hidden audio element for speaker routing */}
      <audio ref={speakerTestRef} className="hidden" />

      {/* Video preview */}
      <div className="relative bg-gray-900 rounded-2xl overflow-hidden aspect-video w-full shadow-xl">
        {stream ? (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className={`w-full h-full object-cover scale-x-[-1] transition-opacity ${isVideoOff ? 'opacity-0' : 'opacity-100'}`}
          />
        ) : null}
        {(!stream || isVideoOff) && (
          <div className="absolute inset-0 w-full h-full flex items-center justify-center bg-gradient-to-br from-gray-800 to-gray-950">
            <div className="w-16 h-16 rounded-full bg-gray-700 flex items-center justify-center">
              <VideoOff className="w-7 h-7 text-gray-500" />
            </div>
          </div>
        )}
        {acquiring && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60 z-10">
            <Loader2 className="w-8 h-8 animate-spin text-teal-400" />
          </div>
        )}

        {/* Mic / Cam toggles */}
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-2 z-10">
          <button
            onClick={toggleMute}
            aria-label={isMuted ? 'فعال کردن میکروفون' : 'قطع میکروفون'}
            aria-pressed={isMuted}
            className={`w-10 h-10 rounded-full flex items-center justify-center shadow-lg transition-all
              ${isMuted ? 'bg-red-600' : 'bg-gray-700/90 hover:bg-gray-600'}`}
          >
            {isMuted ? <MicOff className="w-4 h-4 text-white" /> : <Mic className="w-4 h-4 text-white" />}
          </button>
          <button
            onClick={toggleVideo}
            aria-label={isVideoOff ? 'فعال کردن دوربین' : 'قطع دوربین'}
            aria-pressed={isVideoOff}
            className={`w-10 h-10 rounded-full flex items-center justify-center shadow-lg transition-all
              ${isVideoOff ? 'bg-red-600' : 'bg-gray-700/90 hover:bg-gray-600'}`}
          >
            {isVideoOff ? <VideoOff className="w-4 h-4 text-white" /> : <Video className="w-4 h-4 text-white" />}
          </button>
        </div>
      </div>

      {permError && (
        <div className="px-3 py-2.5 bg-red-900/30 border border-red-700/50 rounded-xl text-red-300 text-sm">
          {permError}
        </div>
      )}

      {/* Device settings card */}
      <div className="bg-gray-900 rounded-2xl border border-gray-800 p-4 space-y-4">

        {/* Microphone */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-gray-400 flex items-center gap-1.5">
            <Mic className="w-3.5 h-3.5" /> میکروفون
          </label>
          <select
            value={selectedAudioInput}
            onChange={e => handleAudioInputChange(e.target.value)}
            className="w-full bg-gray-800 text-white text-sm rounded-xl px-3 py-2 border border-gray-700 focus:outline-hidden focus:ring-1 focus:ring-teal-500"
          >
            {audioInputs.length === 0 && <option value="">میکروفونی یافت نشد</option>}
            {audioInputs.map(d => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || `میکروفون ${d.deviceId.slice(0, 6)}`}
              </option>
            ))}
          </select>
          <div className="flex items-center gap-2 pt-0.5">
            <span className="text-xs text-gray-500 w-12 shrink-0">سطح صدا</span>
            <div
              role="meter"
              aria-label="سطح صدای میکروفون"
              aria-valuenow={volume}
              aria-valuemin={0}
              aria-valuemax={100}
              className="flex gap-0.5 flex-1"
            >
              {Array.from({ length: bars }).map((_, i) => {
                const threshold = ((i + 1) / bars) * 100;
                const active = volume >= threshold;
                const color = i < bars * 0.5 ? 'bg-teal-500' : i < bars * 0.8 ? 'bg-yellow-400' : 'bg-red-500';
                return (
                  <div key={i} className={`flex-1 h-2 rounded-xs transition-all duration-75 ${active ? color : 'bg-gray-700'}`} />
                );
              })}
            </div>
            {isMuted && <span className="text-xs text-red-400 shrink-0">قطع</span>}
          </div>
        </div>

        {/* Speaker */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-gray-400 flex items-center gap-1.5">
            <Volume2 className="w-3.5 h-3.5" /> اسپیکر
          </label>
          <div className="flex gap-2">
            <select
              value={selectedAudioOutput}
              onChange={e => handleAudioOutputChange(e.target.value)}
              className="flex-1 bg-gray-800 text-white text-sm rounded-xl px-3 py-2 border border-gray-700 focus:outline-hidden focus:ring-1 focus:ring-teal-500"
            >
              {audioOutputs.length === 0 && <option value="">اسپیکر پیش‌فرض</option>}
              {audioOutputs.map(d => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `اسپیکر ${d.deviceId.slice(0, 6)}`}
                </option>
              ))}
            </select>
            <button
              onClick={playTestSound}
              disabled={testingSound}
              title="تست صدا"
              aria-label="پخش صدای آزمایشی"
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium transition-all shrink-0
                ${soundTestDone
                  ? 'bg-teal-900/50 text-teal-400 border border-teal-700'
                  : testingSound
                    ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
                    : 'bg-gray-700 hover:bg-gray-600 text-gray-200 border border-gray-600'}`}
            >
              {soundTestDone
                ? <><CheckCircle2 className="w-3.5 h-3.5" /> شنیدم</>
                : testingSound
                  ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> در حال پخش</>
                  : <><VolumeX className="w-3.5 h-3.5" /> تست</>
              }
            </button>
          </div>
        </div>

        {/* Camera */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-gray-400 flex items-center gap-1.5">
            <Video className="w-3.5 h-3.5" /> دوربین
          </label>
          <div className="flex gap-2">
            <select
              value={selectedVideo}
              onChange={e => handleVideoChange(e.target.value)}
              className="flex-1 bg-gray-800 text-white text-sm rounded-xl px-3 py-2 border border-gray-700 focus:outline-hidden focus:ring-1 focus:ring-teal-500"
            >
              {videoInputs.length === 0 && <option value="">دوربینی یافت نشد</option>}
              {videoInputs.map(d => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `دوربین ${d.deviceId.slice(0, 6)}`}
                </option>
              ))}
            </select>
            <button
              onClick={() => acquireStream(selectedVideo, selectedAudioInput, isVideoOff)}
              disabled={acquiring}
              title="بارگذاری مجدد"
              aria-label="بارگذاری مجدد دستگاه‌ها"
              className="p-2.5 rounded-xl bg-gray-700 hover:bg-gray-600 text-gray-300 border border-gray-600 transition-colors shrink-0 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${acquiring ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      </div>

      {children}

      <button
        onClick={handleConfirm}
        disabled={!stream || acquiring || !!submitDisabled}
        className="w-full py-3 bg-teal-500 hover:bg-teal-600 text-white rounded-xl font-semibold text-base transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-lg"
      >
        {acquiring
          ? <><Loader2 className="w-5 h-5 animate-spin" /> در حال دریافت دستگاه...</>
          : submitLabel
        }
      </button>
    </div>
  );
}
