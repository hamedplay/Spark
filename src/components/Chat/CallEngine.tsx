import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Phone, PhoneOff, Video, VideoOff, Mic, MicOff, Volume2, VolumeX,
  Minimize2, User,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import type { UserProfile } from './types';

export interface CallSession {
  id: string;
  caller_id: string;
  callee_id: string;
  call_type: 'audio' | 'video';
  status: 'ringing' | 'active' | 'ended' | 'declined' | 'missed';
  offer: string | null;
  answer: string | null;
  caller_candidates: RTCIceCandidateInit[];
  callee_candidates: RTCIceCandidateInit[];
  conversation_id: string | null;
  started_at: string | null;
}

interface Props {
  currentUserId: string;
  otherUser: UserProfile;
  callType: 'audio' | 'video';
  mode: 'caller' | 'callee';
  session: CallSession;
  onEnd: () => void;
}

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

// iOS Safari detection
const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;

export function CallEngine({ currentUserId, otherUser, callType, mode, session, onEnd }: Props) {
  const [callStatus, setCallStatus] = useState<'connecting' | 'active' | 'ended'>('connecting');
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [isSpeakerOff, setIsSpeakerOff] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [isMinimized, setIsMinimized] = useState(false);
  const [statusText, setStatusText] = useState('در حال اتصال...');

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const sigChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const durationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sessionIdRef = useRef(session.id);
  const endedRef = useRef(false);
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const callDurationRef = useRef(0);

  // Keep callDurationRef in sync so cleanup always has latest value
  useEffect(() => { callDurationRef.current = callDuration; }, [callDuration]);

  useEffect(() => {
    sessionIdRef.current = session.id;
    initCall();
    return () => { cleanup(false); };
  }, []);

  const cleanup = useCallback((updateDB = true) => {
    if (endedRef.current) return;
    endedRef.current = true;
    if (durationTimerRef.current) clearInterval(durationTimerRef.current);
    sigChannelRef.current?.unsubscribe();
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    remoteStreamRef.current?.getTracks().forEach(t => t.stop());
    try { pcRef.current?.close(); } catch { /* ignore */ }
    if (updateDB) {
      supabase.from('call_sessions').update({
        status: 'ended',
        ended_at: new Date().toISOString(),
        duration_seconds: callDurationRef.current,
      }).eq('id', sessionIdRef.current).then(() => {});
    }
  }, []);

  // ── Attach remote stream to media elements ──────────────────────────────
  // iOS Safari requires calling .play() manually and reacting to srcObject changes
  const attachRemoteStream = useCallback((stream: MediaStream) => {
    remoteStreamRef.current = stream;

    if (callType === 'video' && remoteVideoRef.current) {
      const vid = remoteVideoRef.current;
      vid.srcObject = stream;
      vid.muted = false;
      // iOS requires explicit play() after setting srcObject
      vid.play().catch(() => {
        // Autoplay blocked — we show a tap-to-unmute button handled in UI
      });
    }

    // Always attach audio element too (handles audio-only + iOS video audio routing)
    if (remoteAudioRef.current) {
      const aud = remoteAudioRef.current;
      aud.srcObject = stream;
      aud.muted = isSpeakerOff;
      aud.play().catch(() => {});
    }
  }, [callType, isSpeakerOff]);

  // ── Signaling via Supabase Broadcast ────────────────────────────────────
  const setupSignalingChannel = (pc: RTCPeerConnection) => {
    const channel = supabase.channel(`call-sig-${session.id}`, {
      config: { broadcast: { self: false, ack: false } },
    });

    channel.on('broadcast', { event: 'signal' }, async ({ payload }: any) => {
      if (!payload || payload.from === currentUserId) return;

      if (payload.type === 'offer' && mode === 'callee') {
        await handleOffer(pc, payload.sdp);

      } else if (payload.type === 'answer' && mode === 'caller') {
        try {
          if (!pc.remoteDescription) {
            await pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: payload.sdp }));
            await drainPendingCandidates(pc);
            // Fetch callee's ICE candidates from DB in case some were missed
            const { data: sess } = await supabase
              .from('call_sessions').select('callee_candidates').eq('id', session.id).maybeSingle();
            for (const c of (sess?.callee_candidates || [])) {
              try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch { /* ignore */ }
            }
          }
        } catch (e) { console.error('answer error', e); }

      } else if (payload.type === 'ice') {
        const candidate: RTCIceCandidateInit = payload.candidate;
        if (!candidate) return;
        if (pc.remoteDescription) {
          try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch { /* ignore */ }
        } else {
          pendingCandidatesRef.current.push(candidate);
        }

      } else if (payload.type === 'end') {
        setStatusText('تماس پایان یافت');
        setCallStatus('ended');
        cleanup(false);
        setTimeout(onEnd, 1200);
      }
    });

    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED' && mode === 'caller') {
        sendOfferAsCaller(pc);
      }
    });

    sigChannelRef.current = channel;
  };

  const sendSignal = (payload: Record<string, unknown>) => {
    sigChannelRef.current?.send({
      type: 'broadcast',
      event: 'signal',
      payload: { ...payload, from: currentUserId },
    });
  };

  const drainPendingCandidates = async (pc: RTCPeerConnection) => {
    for (const c of pendingCandidatesRef.current) {
      try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch { /* ignore */ }
    }
    pendingCandidatesRef.current = [];
  };

  const handleOffer = async (pc: RTCPeerConnection, sdp: string) => {
    if (pc.remoteDescription) return;
    try {
      await pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp }));
      await drainPendingCandidates(pc);
      // Also fetch caller's ICE candidates from DB in case some were missed via broadcast
      const { data: sess } = await supabase
        .from('call_sessions').select('caller_candidates').eq('id', session.id).maybeSingle();
      for (const c of (sess?.caller_candidates || [])) {
        try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch { /* ignore */ }
      }
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      sendSignal({ type: 'answer', sdp: answer.sdp });
      await supabase.from('call_sessions').update({
        answer: answer.sdp, status: 'active', started_at: new Date().toISOString(),
      }).eq('id', session.id);
    } catch (e) { console.error('offer handling error', e); }
  };

  const sendOfferAsCaller = async (pc: RTCPeerConnection) => {
    try {
      // iOS Safari requires explicit offerToReceive flags
      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: callType === 'video',
      });
      await pc.setLocalDescription(offer);
      sendSignal({ type: 'offer', sdp: offer.sdp });
      await supabase.from('call_sessions').update({ offer: offer.sdp }).eq('id', session.id);
      setStatusText('در انتظار پاسخ...');
    } catch (e) { console.error('createOffer error', e); }
  };

  // ── Main init ────────────────────────────────────────────────────────────
  const initCall = async () => {
    setStatusText(mode === 'caller' ? 'در حال شروع تماس...' : 'در حال اتصال...');

    // iOS Safari: video constraints must be simpler — avoid ideal width/height
    // that can fail on older iPhones
    const videoConstraints: MediaTrackConstraints = isIOS()
      ? { facingMode: 'user' }
      : { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' };

    const constraints: MediaStreamConstraints = {
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        // iOS Safari does not support sampleRate constraint — omit it
      },
      video: callType === 'video' ? videoConstraints : false,
    };

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err: any) {
      // iOS: if video fails, retry with audio only for audio calls
      if (callType === 'audio') {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch {
          setStatusText('دسترسی به میکروفون رد شد. لطفاً مجوز را از تنظیمات مرورگر فعال کنید.');
          setTimeout(onEnd, 3000);
          return;
        }
      } else {
        setStatusText('دسترسی به دوربین/میکروفون رد شد. لطفاً مجوز را از تنظیمات فعال کنید.');
        setTimeout(onEnd, 3000);
        return;
      }
    }

    localStreamRef.current = stream;

    // Attach local video — iOS requires playsInline (already on element via JSX)
    if (localVideoRef.current && callType === 'video') {
      localVideoRef.current.srcObject = stream;
      localVideoRef.current.play().catch(() => {});
    }

    // Build PeerConnection
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS, iceCandidatePoolSize: 10 });
    pcRef.current = pc;

    // Add tracks
    stream.getTracks().forEach(track => pc.addTrack(track, stream));

    // ontrack — iOS Safari sometimes provides empty streams array; handle both cases
    pc.ontrack = (event) => {
      let remoteStream: MediaStream;
      if (event.streams && event.streams.length > 0) {
        remoteStream = event.streams[0];
      } else {
        // Fallback: build stream from tracks (needed on some iOS versions)
        if (!remoteStreamRef.current) {
          remoteStreamRef.current = new MediaStream();
        }
        remoteStreamRef.current.addTrack(event.track);
        remoteStream = remoteStreamRef.current;
      }
      attachRemoteStream(remoteStream);
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        const candidate = event.candidate.toJSON();
        // Send via broadcast (fast path)
        sendSignal({ type: 'ice', candidate });
        // Also persist to DB (fallback for when broadcast is missed)
        const field = mode === 'caller' ? 'caller_candidates' : 'callee_candidates';
        supabase.rpc('append_ice_candidate', {
          p_session_id: sessionIdRef.current,
          p_field: field,
          p_candidate: candidate,
        }).then(() => {});
      }
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      if (state === 'connected') {
        setCallStatus('active');
        setStatusText('');
        if (!durationTimerRef.current) {
          durationTimerRef.current = setInterval(() => setCallDuration(d => d + 1), 1000);
        }
        // iOS: resume AudioContext if suspended (autoplay policy)
        resumeAudioContext();
      } else if (state === 'failed') {
        setStatusText('اتصال ناموفق بود');
        setCallStatus('ended');
        cleanup(true);
        setTimeout(onEnd, 1500);
      } else if (state === 'disconnected') {
        setStatusText('اتصال قطع شد');
      }
    };

    pc.oniceconnectionstatechange = () => {
      const s = pc.iceConnectionState;
      if (s === 'connected' || s === 'completed') {
        setCallStatus('active');
        setStatusText('');
        if (!durationTimerRef.current) {
          durationTimerRef.current = setInterval(() => setCallDuration(d => d + 1), 1000);
        }
      }
    };

    setupSignalingChannel(pc);

    // Callee: broadcast offer is sent before CallEngine mounts, always fetch from DB.
    // Retry up to 5 times with increasing intervals.
    if (mode === 'callee') {
      const tryFetchOffer = async (attempt: number) => {
        if (pc.remoteDescription || endedRef.current) return;
        const { data } = await supabase
          .from('call_sessions').select('offer, status').eq('id', session.id).maybeSingle();
        if (!data || data.status === 'declined' || data.status === 'ended') { onEnd(); return; }
        if (data.offer) {
          await handleOffer(pc, data.offer);
        } else if (attempt < 5) {
          setTimeout(() => tryFetchOffer(attempt + 1), attempt * 600 + 400);
        }
      };
      setTimeout(() => tryFetchOffer(1), 600);
    }

    // Caller: if answer not received via broadcast within 5s, fetch from DB.
    // Then poll every 3s until connected or ended.
    if (mode === 'caller') {
      const pollForAnswer = async () => {
        if (endedRef.current || pc.connectionState === 'connected' || (pc.iceConnectionState as string) === 'completed') return;
        if (pc.remoteDescription) return;
        const { data } = await supabase
          .from('call_sessions').select('answer, status').eq('id', session.id).maybeSingle();
        if (!data || data.status === 'declined' || data.status === 'ended') { onEnd(); return; }
        if (data.answer) {
          try {
            await pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: data.answer }));
            await drainPendingCandidates(pc);
            // Also fetch callee's ICE candidates from DB
            const { data: sess } = await supabase
              .from('call_sessions').select('callee_candidates').eq('id', session.id).maybeSingle();
            for (const c of (sess?.callee_candidates || [])) {
              try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch { /* ignore */ }
            }
          } catch (e) { console.error('DB answer fallback error', e); }
        } else if (!endedRef.current) {
          setTimeout(pollForAnswer, 3000);
        }
      };
      setTimeout(pollForAnswer, 5000);
    }
  };

  // iOS Safari suspends AudioContext — resume on user interaction
  const resumeAudioContext = () => {
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioContextClass) {
        const ctx = new AudioContextClass();
        if (ctx.state === 'suspended') ctx.resume();
      }
    } catch { /* ignore */ }
  };

  const endCall = () => {
    sendSignal({ type: 'end' });
    setCallStatus('ended');
    setStatusText('تماس پایان یافت');
    cleanup(true);
    setTimeout(onEnd, 800);
  };

  const toggleMute = () => {
    localStreamRef.current?.getAudioTracks().forEach(t => { t.enabled = isMuted; });
    setIsMuted(v => !v);
  };

  const toggleVideo = () => {
    localStreamRef.current?.getVideoTracks().forEach(t => { t.enabled = isVideoOff; });
    setIsVideoOff(v => !v);
  };

  const toggleSpeaker = () => {
    const newMuted = !isSpeakerOff;
    if (remoteVideoRef.current) remoteVideoRef.current.muted = newMuted;
    if (remoteAudioRef.current) {
      remoteAudioRef.current.muted = newMuted;
      if (!newMuted) remoteAudioRef.current.play().catch(() => {});
    }
    setIsSpeakerOff(newMuted);
  };

  const formatDuration = (s: number) => {
    const m = Math.floor(s / 60).toString().padStart(2, '0');
    const sec = (s % 60).toString().padStart(2, '0');
    return `${m}:${sec}`;
  };

  const otherName = otherUser.full_name || otherUser.email || 'کاربر';

  // ── Minimized bubble ─────────────────────────────────────────────────────
  if (isMinimized) {
    return (
      <div
        className="fixed bottom-6 left-6 z-[9998] bg-gray-900 rounded-2xl shadow-2xl p-3 flex items-center gap-3 cursor-pointer border border-gray-700"
        onClick={() => setIsMinimized(false)}
      >
        <div className="w-10 h-10 rounded-full bg-teal-500 flex items-center justify-center text-white font-bold text-sm">
          {otherName[0]?.toUpperCase()}
        </div>
        <div>
          <p className="text-white text-sm font-medium">{otherName}</p>
          <p className="text-teal-400 text-xs">
            {callStatus === 'active' ? formatDuration(callDuration) : statusText || 'در حال اتصال...'}
          </p>
        </div>
        <button
          onClick={e => { e.stopPropagation(); endCall(); }}
          className="w-9 h-9 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center transition-colors"
        >
          <PhoneOff className="w-4 h-4 text-white" />
        </button>
      </div>
    );
  }

  // ── Full UI ───────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/85 backdrop-blur-md" dir="rtl">
      {/*
        iOS Safari: audio element MUST be in the DOM, have playsInline, and NOT have autoPlay
        hidden — we call .play() manually. Using a visible element with opacity-0 is more reliable
        than display:none on iOS.
      */}
      <audio
        ref={remoteAudioRef}
        playsInline
        style={{ position: 'absolute', width: 0, height: 0, opacity: 0 }}
      />

      <div
        className={`relative bg-gray-900 rounded-3xl shadow-2xl overflow-hidden flex flex-col
          ${callType === 'video' ? 'w-full max-w-2xl' : 'w-full max-w-sm mx-4'}`}
        style={{ maxHeight: '92vh' }}
      >
        {/* Video area */}
        {callType === 'video' && (
          <div className="relative bg-black flex-1 min-h-72">
            {/* Remote video — playsInline is mandatory on iOS */}
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              muted={isSpeakerOff}
              className="w-full h-full object-cover"
            />
            {/* Local PiP */}
            <div className="absolute bottom-3 left-3 w-28 h-20 rounded-xl overflow-hidden border-2 border-white/30 shadow-lg bg-gray-800">
              <video
                ref={localVideoRef}
                autoPlay
                playsInline
                muted
                className={`w-full h-full object-cover ${isVideoOff ? 'opacity-0' : ''}`}
              />
              {isVideoOff && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <User className="w-8 h-8 text-gray-500" />
                </div>
              )}
            </div>
          </div>
        )}

        {/* Audio-only avatar */}
        {callType === 'audio' && (
          <div className="flex flex-col items-center justify-center py-12 gap-5">
            <div className="relative">
              {callStatus === 'active' && (
                <>
                  <div className="absolute inset-0 rounded-full bg-teal-500/20 animate-ping scale-125" />
                  <div className="absolute inset-0 rounded-full bg-teal-500/10 animate-ping scale-150" style={{ animationDelay: '200ms' }} />
                </>
              )}
              <div className="w-24 h-24 rounded-full bg-gradient-to-br from-teal-500 to-teal-700 flex items-center justify-center text-white text-3xl font-bold shadow-xl relative z-10">
                {otherName[0]?.toUpperCase()}
              </div>
            </div>
            <p className="text-white text-xl font-semibold">{otherName}</p>
          </div>
        )}

        {/* Status bar */}
        <div className="px-5 py-3 flex items-center justify-between bg-gray-900/90">
          <div>
            {callType === 'video' && <p className="text-white font-semibold text-sm">{otherName}</p>}
            <p className={`text-sm font-medium ${
              callStatus === 'active' ? 'text-teal-400' :
              callStatus === 'ended' ? 'text-red-400' :
              'text-gray-400 animate-pulse'
            }`}>
              {callStatus === 'active' ? formatDuration(callDuration) :
               callStatus === 'ended' ? 'تماس پایان یافت' :
               statusText}
            </p>
          </div>
          <button
            onClick={() => setIsMinimized(true)}
            className="p-2 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition-colors"
          >
            <Minimize2 className="w-4 h-4" />
          </button>
        </div>

        {/* Controls */}
        <div className="px-6 pb-7 pt-2 bg-gray-900 flex items-center justify-center gap-5">
          <ControlBtn active={isMuted} activeColor="red" onClick={toggleMute} title={isMuted ? 'روشن میکروفون' : 'خاموش میکروفون'}>
            {isMuted ? <MicOff className="w-6 h-6 text-white" /> : <Mic className="w-6 h-6 text-white" />}
          </ControlBtn>

          <ControlBtn active={isSpeakerOff} activeColor="red" onClick={toggleSpeaker} title={isSpeakerOff ? 'روشن بلندگو' : 'خاموش بلندگو'}>
            {isSpeakerOff ? <VolumeX className="w-6 h-6 text-white" /> : <Volume2 className="w-6 h-6 text-white" />}
          </ControlBtn>

          {callType === 'video' && (
            <ControlBtn active={isVideoOff} activeColor="red" onClick={toggleVideo} title={isVideoOff ? 'روشن دوربین' : 'خاموش دوربین'}>
              {isVideoOff ? <VideoOff className="w-6 h-6 text-white" /> : <Video className="w-6 h-6 text-white" />}
            </ControlBtn>
          )}

          <button
            onClick={endCall}
            className="w-16 h-16 rounded-full bg-red-500 hover:bg-red-600 active:bg-red-700 flex items-center justify-center transition-all shadow-xl"
          >
            <PhoneOff className="w-7 h-7 text-white" />
          </button>
        </div>
      </div>
    </div>
  );
}

function ControlBtn({ active, activeColor, onClick, title, children }: {
  active: boolean;
  activeColor: 'red' | 'teal';
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`w-14 h-14 rounded-full flex items-center justify-center transition-all shadow-lg
        ${active
          ? activeColor === 'red' ? 'bg-red-500 hover:bg-red-600' : 'bg-teal-500 hover:bg-teal-600'
          : 'bg-gray-700 hover:bg-gray-600'
        }`}
    >
      {children}
    </button>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   Incoming call notification
────────────────────────────────────────────────────────────────────────── */
interface IncomingCallProps {
  session: CallSession;
  callerProfile: UserProfile | null;
  onAccept: () => void;
  onDecline: () => void;
}

export function IncomingCallNotification({ session, callerProfile, onAccept, onDecline }: IncomingCallProps) {
  useEffect(() => {
    const t = setTimeout(onDecline, 45000);
    return () => clearTimeout(t);
  }, []);

  const name = callerProfile?.full_name || callerProfile?.email || 'کاربر';

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm" dir="rtl">
      <div className="bg-gray-900 rounded-3xl shadow-2xl w-full max-w-xs mx-4 overflow-hidden border border-gray-700">
        <div className="px-6 py-8 flex flex-col items-center gap-5">
          <div className="relative">
            <div className="absolute inset-0 rounded-full bg-teal-500/30 animate-ping" />
            <div className="w-20 h-20 rounded-full bg-gradient-to-br from-teal-500 to-teal-700 flex items-center justify-center text-white text-2xl font-bold shadow-xl relative z-10">
              {name[0]?.toUpperCase()}
            </div>
          </div>
          <div className="text-center">
            <p className="text-white font-bold text-xl">{name}</p>
            <p className="text-gray-400 text-sm mt-1.5 flex items-center justify-center gap-1.5 animate-pulse">
              {session.call_type === 'video'
                ? <><Video className="w-4 h-4" /> تماس تصویری ورودی</>
                : <><Phone className="w-4 h-4" /> تماس صوتی ورودی</>
              }
            </p>
          </div>
        </div>

        <div className="px-6 pb-7 flex gap-6 justify-center">
          <div className="flex flex-col items-center gap-2">
            <button
              onClick={onDecline}
              className="w-16 h-16 rounded-full bg-red-500 hover:bg-red-600 active:bg-red-700 flex items-center justify-center transition-all shadow-xl"
            >
              <PhoneOff className="w-7 h-7 text-white" />
            </button>
            <span className="text-gray-400 text-xs">رد کردن</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            {/*
              iOS: onAccept must directly trigger getUserMedia — so the accept button
              tap IS the user gesture that unlocks media access
            */}
            <button
              onClick={onAccept}
              className="w-16 h-16 rounded-full bg-teal-500 hover:bg-teal-600 active:bg-teal-700 flex items-center justify-center transition-all shadow-xl animate-bounce"
            >
              {session.call_type === 'video'
                ? <Video className="w-7 h-7 text-white" />
                : <Phone className="w-7 h-7 text-white" />
              }
            </button>
            <span className="text-gray-400 text-xs">پاسخ دادن</span>
          </div>
        </div>
      </div>
    </div>
  );
}
