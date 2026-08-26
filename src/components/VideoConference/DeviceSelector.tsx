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
  compactViewport?: boolean;
}

export function DeviceSelector({ onConfirm, submitLabel = 'ادامه', children, submitDisabled, compactViewport = false }: Props) {
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

  const micReady = Boolean(stream?.getAudioTracks().some(track => track.readyState === 'live'));
  const cameraReady = Boolean(stream?.getVideoTracks().some(track => track.readyState === 'live'));

  return (
    <div className={compactViewport ? "grid items-start gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.72fr)] lg:gap-5" : "space-y-4"} dir="rtl">
      <audio ref={speakerTestRef} className="hidden" />

      <section className={`relative overflow-hidden rounded-3xl border border-white/10 bg-slate-950 shadow-2xl ${compactViewport ? 'lg:sticky lg:top-6' : ''}`}>
        <div className="absolute right-4 top-4 z-20 rounded-full border border-white/10 bg-black/45 px-3 py-1.5 text-[10px] font-semibold text-slate-200 backdrop-blur">
          پیش‌نمایش شما
        </div>
        <div className="relative aspect-video w-full overflow-hidden bg-black">
          {stream ? (
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className={`h-full w-full object-cover scale-x-[-1] transition-opacity ${isVideoOff ? 'opacity-0' : 'opacity-100'}`}
            />
          ) : null}
          {(!stream || isVideoOff) && (
            <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-slate-900 to-black">
              <div className="flex h-20 w-20 items-center justify-center rounded-full border border-white/10 bg-white/5">
                <VideoOff className="h-8 w-8 text-slate-500" />
              </div>
            </div>
          )}
          {acquiring && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/60">
              <Loader2 className="h-8 w-8 animate-spin text-teal-400" />
            </div>
          )}

          <div className="absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 gap-2 rounded-2xl border border-white/10 bg-slate-950/70 p-1.5 shadow-xl backdrop-blur">
            <button
              type="button"
              onClick={toggleMute}
              aria-label={isMuted ? 'فعال کردن میکروفون' : 'قطع میکروفون'}
              aria-pressed={isMuted}
              className={`flex h-11 min-w-11 items-center justify-center rounded-xl px-3 transition ${isMuted ? 'bg-rose-600 text-white' : 'bg-white/10 text-white hover:bg-white/15'}`}
            >
              {isMuted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
            </button>
            <button
              type="button"
              onClick={toggleVideo}
              aria-label={isVideoOff ? 'فعال کردن دوربین' : 'قطع دوربین'}
              aria-pressed={isVideoOff}
              className={`flex h-11 min-w-11 items-center justify-center rounded-xl px-3 transition ${isVideoOff ? 'bg-rose-600 text-white' : 'bg-white/10 text-white hover:bg-white/15'}`}
            >
              {isVideoOff ? <VideoOff className="h-5 w-5" /> : <Video className="h-5 w-5" />}
            </button>
          </div>
        </div>
      </section>

      <section className="min-w-0 space-y-3 rounded-3xl border border-white/10 bg-slate-900/80 p-3.5 shadow-xl backdrop-blur sm:p-4">
        {permError && (
          <div className="rounded-xl border border-rose-500/25 bg-rose-500/10 px-3 py-2.5 text-xs leading-6 text-rose-200">
            {permError}
          </div>
        )}

        {children}

        <div className="grid grid-cols-2 gap-2">
          <div className={`rounded-xl border px-3 py-2.5 ${micReady ? 'border-emerald-500/15 bg-emerald-500/5' : 'border-white/10 bg-white/5'}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-[11px] font-bold text-slate-200"><Mic className="h-3.5 w-3.5" /> میکروفون</span>
              <span className={`text-[10px] ${micReady && !isMuted ? 'text-emerald-300' : 'text-slate-400'}`}>{isMuted ? 'خاموش' : micReady ? 'آماده' : 'نامشخص'}</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-700">
              <div className="h-full rounded-full bg-teal-400 transition-[width] duration-100" style={{ width: `${isMuted ? 0 : Math.max(3, volume)}%` }} />
            </div>
          </div>
          <div className={`rounded-xl border px-3 py-2.5 ${cameraReady ? 'border-emerald-500/15 bg-emerald-500/5' : 'border-white/10 bg-white/5'}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-[11px] font-bold text-slate-200"><Video className="h-3.5 w-3.5" /> دوربین</span>
              <span className={`text-[10px] ${cameraReady && !isVideoOff ? 'text-emerald-300' : 'text-slate-400'}`}>{isVideoOff ? 'خاموش' : cameraReady ? 'آماده' : 'نامشخص'}</span>
            </div>
            <p className="mt-1.5 truncate text-[9px] text-slate-500">{videoInputs.find(d => d.deviceId === selectedVideo)?.label || 'دوربین پیش‌فرض'}</p>
          </div>
        </div>

        <details className="group rounded-xl border border-white/10 bg-slate-950/50">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3 text-xs font-bold text-slate-200">
            <span>تنظیمات صدا و تصویر</span>
            <RefreshCw className="h-3.5 w-3.5 text-slate-500 transition group-open:rotate-180" />
          </summary>
          <div className="space-y-3 border-t border-white/10 p-3">
            <div className="space-y-1.5">
              <label className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-400"><Mic className="h-3.5 w-3.5" /> میکروفون</label>
              <select value={selectedAudioInput} onChange={e => void handleAudioInputChange(e.target.value)} className="w-full rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-xs text-white outline-none focus:border-teal-400">
                {audioInputs.length === 0 && <option value="">میکروفونی یافت نشد</option>}
                {audioInputs.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || `میکروفون ${d.deviceId.slice(0, 6)}`}</option>)}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-400"><Volume2 className="h-3.5 w-3.5" /> خروجی صدا</label>
              <div className="flex gap-2">
                <select value={selectedAudioOutput} onChange={e => handleAudioOutputChange(e.target.value)} className="min-w-0 flex-1 rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-xs text-white outline-none focus:border-teal-400">
                  {audioOutputs.length === 0 && <option value="">اسپیکر پیش‌فرض</option>}
                  {audioOutputs.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || `اسپیکر ${d.deviceId.slice(0, 6)}`}</option>)}
                </select>
                <button type="button" onClick={() => void playTestSound()} disabled={testingSound} className="min-h-10 shrink-0 rounded-xl border border-white/10 bg-slate-800 px-3 text-[10px] font-bold text-slate-200 disabled:opacity-50">
                  {soundTestDone ? <span className="flex items-center gap-1 text-emerald-300"><CheckCircle2 className="h-3.5 w-3.5" /> شنیدم</span> : testingSound ? 'در حال پخش' : 'تست صدا'}
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-400"><Video className="h-3.5 w-3.5" /> دوربین</label>
              <div className="flex gap-2">
                <select value={selectedVideo} onChange={e => void handleVideoChange(e.target.value)} className="min-w-0 flex-1 rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-xs text-white outline-none focus:border-teal-400">
                  {videoInputs.length === 0 && <option value="">دوربینی یافت نشد</option>}
                  {videoInputs.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || `دوربین ${d.deviceId.slice(0, 6)}`}</option>)}
                </select>
                <button type="button" onClick={() => void acquireStream(selectedVideo, selectedAudioInput, isVideoOff)} disabled={acquiring} aria-label="بارگذاری مجدد دستگاه‌ها" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-slate-800 text-slate-300 disabled:opacity-50">
                  <RefreshCw className={`h-3.5 w-3.5 ${acquiring ? 'animate-spin' : ''}`} />
                </button>
              </div>
            </div>
          </div>
        </details>

        <button
          type="button"
          onClick={handleConfirm}
          disabled={!stream || acquiring || !!submitDisabled}
          className="sticky bottom-3 z-20 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-teal-400 px-4 text-sm font-extrabold text-slate-950 shadow-lg shadow-teal-950/30 transition hover:bg-teal-300 disabled:cursor-not-allowed disabled:opacity-45"
        >
          {acquiring ? <><Loader2 className="h-5 w-5 animate-spin" /> در حال آماده‌سازی دستگاه‌ها...</> : submitLabel}
        </button>
      </section>
    </div>
  );
}
