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
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || '{}');
  } catch {
    return {};
  }
}

function savePrefs(p: Partial<DevicePrefs>) {
  try {
    const existing = loadPrefs();
    localStorage.setItem(LS_KEY, JSON.stringify({ ...existing, ...p }));
  } catch {}
}

interface Props {
  /** Called when the user confirms device selection. The stream is already live. */
  onConfirm: (stream: MediaStream, prefs: DevicePrefs) => void;
  /** Optional submit button label */
  submitLabel?: string;
  /** Extra content (e.g. name input, password field) rendered above the submit button */
  children?: React.ReactNode;
  /** Whether the submit button should be disabled (e.g. required field not filled) */
  submitDisabled?: boolean;
}

export function DeviceSelector({ onConfirm, submitLabel = 'ادامه', children, submitDisabled }: Props) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedAudioInput, setSelectedAudioInput] = useState('');
  const [selectedAudioOutput, setSelectedAudioOutput] = useState('');
  const [selectedVideo, setSelectedVideo] = useState('');

  const [stream, setStream] = useState<MediaStream | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [acquiring, setAcquiring] = useState(false);
  const [permError, setPermError] = useState('');

  // Volume meter
  const [volume, setVolume] = useState(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number>(0);
  const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);

  // Speaker test
  const [testingSound, setTestingSound] = useState(false);
  const [soundTestDone, setSoundTestDone] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  useEffect(() => { streamRef.current = stream; }, [stream]);

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

      const vd = list.filter(d => d.kind === 'videoinput');
      const ai = list.filter(d => d.kind === 'audioinput');
      const ao = list.filter(d => d.kind === 'audiooutput');

      setSelectedVideo(prev => {
        if (prev && hasId('videoinput', prev)) return prev;
        if (saved.videoInputId && hasId('videoinput', saved.videoInputId)) return saved.videoInputId;
        return vd[0]?.deviceId || '';
      });
      setSelectedAudioInput(prev => {
        if (prev && hasId('audioinput', prev)) return prev;
        if (saved.audioInputId && hasId('audioinput', saved.audioInputId)) return saved.audioInputId;
        return ai[0]?.deviceId || '';
      });
      setSelectedAudioOutput(prev => {
        if (prev && hasId('audiooutput', prev)) return prev;
        if (saved.audioOutputId && hasId('audiooutput', saved.audioOutputId)) return saved.audioOutputId;
        return ao[0]?.deviceId || '';
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
        analyser.getByteFrequencyData(data);
        const avg = data.reduce((a, b) => a + b, 0) / data.length;
        setVolume(Math.min(100, Math.round((avg / 128) * 100)));
        animFrameRef.current = requestAnimationFrame(tick);
      };
      animFrameRef.current = requestAnimationFrame(tick);
    } catch {}
  }, [stopVolumeMeter]);

  // ── Acquire stream ─────────────────────────────────────────────────────────
  const acquireStream = useCallback(async (
    videoId: string, audioId: string, videoOff = false,
  ) => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    stopVolumeMeter();
    setAcquiring(true);
    setPermError('');

    const videoConstraint = videoOff ? false : (videoId ? { deviceId: { exact: videoId } } : true);
    const audioConstraint = audioId ? { deviceId: { exact: audioId } } : true;

    let s: MediaStream | null = null;
    try {
      s = await navigator.mediaDevices.getUserMedia({
        video: videoConstraint,
        audio: audioConstraint,
      });
      setIsVideoOff(false);
    } catch {
      try {
        s = await navigator.mediaDevices.getUserMedia({ audio: audioConstraint });
        setIsVideoOff(true);
      } catch {
        setPermError('دسترسی به دوربین و میکروفن امکان‌پذیر نیست. لطفاً مجوزها را بررسی کنید.');
        setAcquiring(false);
        return;
      }
    }

    setStream(s);
    setAcquiring(false);
    await enumerateDevices();
    startVolumeMeter(s);

    // attach to video element
    if (videoRef.current) {
      videoRef.current.srcObject = s;
      videoRef.current.play().catch(() => {});
    }
  }, [enumerateDevices, startVolumeMeter, stopVolumeMeter]);

  // Initial acquire
  useEffect(() => {
    const saved = loadPrefs();
    enumerateDevices().then(() => {
      acquireStream(saved.videoInputId || '', saved.audioInputId || '');
    });
    return () => {
      streamRef.current?.getTracks().forEach(t => t.stop());
      stopVolumeMeter();
      cancelAnimationFrame(animFrameRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update video srcObject when stream changes
  useEffect(() => {
    if (!videoRef.current || !stream) return;
    videoRef.current.srcObject = stream;
    videoRef.current.play().catch(() => {});
  }, [stream]);

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
    // Apply to video element if supported
    const el = audioRef.current as any;
    if (el?.setSinkId) el.setSinkId(deviceId).catch(() => {});
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
    stream?.getVideoTracks().forEach(t => { t.enabled = !next; });
    setIsVideoOff(next);
  };

  // ── Speaker test ───────────────────────────────────────────────────────────
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

      // Route to selected output if supported
      if (selectedAudioOutput && (ctx.destination as any).setSinkId) {
        await (ctx.destination as any).setSinkId(selectedAudioOutput).catch(() => {});
      }
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.8);
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
    const prefs: DevicePrefs = {
      audioInputId: selectedAudioInput,
      audioOutputId: selectedAudioOutput,
      videoInputId: selectedVideo,
    };
    savePrefs(prefs);
    onConfirm(stream, prefs);
  };

  // ── Volume bar segments ────────────────────────────────────────────────────
  const bars = 16;

  return (
    <div className="space-y-4" dir="rtl">
      {/* Video preview */}
      <div className="relative bg-gray-900 rounded-2xl overflow-hidden aspect-video w-full shadow-xl">
        {!isVideoOff && stream ? (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover scale-x-[-1]"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-gray-800 to-gray-950">
            <div className="w-16 h-16 rounded-full bg-gray-700 flex items-center justify-center">
              <VideoOff className="w-7 h-7 text-gray-500" />
            </div>
          </div>
        )}
        {acquiring && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60">
            <Loader2 className="w-8 h-8 animate-spin text-teal-400" />
          </div>
        )}

        {/* Mic / Cam toggles */}
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-2">
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
            className="w-full bg-gray-800 text-white text-sm rounded-xl px-3 py-2 border border-gray-700 focus:outline-none focus:ring-1 focus:ring-teal-500"
          >
            {audioInputs.length === 0 && <option value="">میکروفونی یافت نشد</option>}
            {audioInputs.map(d => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || `میکروفون ${d.deviceId.slice(0, 6)}`}
              </option>
            ))}
          </select>
          {/* Volume bar */}
          <div className="flex items-center gap-2 pt-0.5">
            <span className="text-xs text-gray-500 w-12 flex-shrink-0">سطح صدا</span>
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
                  <div
                    key={i}
                    className={`flex-1 h-2 rounded-sm transition-all duration-75 ${active ? color : 'bg-gray-700'}`}
                  />
                );
              })}
            </div>
            {isMuted && <span className="text-xs text-red-400 flex-shrink-0">قطع</span>}
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
              className="flex-1 bg-gray-800 text-white text-sm rounded-xl px-3 py-2 border border-gray-700 focus:outline-none focus:ring-1 focus:ring-teal-500"
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
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium transition-all flex-shrink-0
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
              className="flex-1 bg-gray-800 text-white text-sm rounded-xl px-3 py-2 border border-gray-700 focus:outline-none focus:ring-1 focus:ring-teal-500"
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
              className="p-2.5 rounded-xl bg-gray-700 hover:bg-gray-600 text-gray-300 border border-gray-600 transition-colors flex-shrink-0 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${acquiring ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      </div>

      {/* Extra content slot (name input, password, etc.) */}
      {children}

      {/* Confirm */}
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
