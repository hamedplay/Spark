import { useState, useRef, useEffect } from 'react';
import { Play, Square, CircleCheck as CheckCircle, Circle as XCircle, CircleAlert as AlertCircle, Wifi, WifiOff, Loader as Loader2, Trash2 } from 'lucide-react';
import { buildRTCConfigFromDB } from './ConferenceRoom';

interface ConfigEntry { id: string; section: string; key: string; value: string | null; value_type: string; label: string | null; description: string | null; }

interface CandidateRow {
  id: number;
  timestamp: string;
  type: string;      // host | srflx | relay | prflx | ''
  protocol: string;  // udp | tcp
  address: string;
  port: string;
  raw: string;
}

interface IceTesterPanelProps {
  configs: ConfigEntry[];
}

type TestStatus = 'idle' | 'running' | 'done' | 'error';

function parseCandidateFields(candidate: RTCIceCandidate): Pick<CandidateRow, 'type' | 'protocol' | 'address' | 'port'> {
  const c = candidate.candidate;
  // SDP candidate format: candidate:<foundation> <component> <protocol> <priority> <address> <port> typ <type> ...
  const parts = c.split(' ');
  const typIdx = parts.indexOf('typ');
  const type = typIdx >= 0 ? parts[typIdx + 1] : (candidate.type ?? '');
  const protocol = parts[2]?.toLowerCase() ?? '';
  const address = parts[4] ?? '';
  const port = parts[5] ?? '';
  return { type, protocol, address, port };
}

function typeColor(type: string) {
  switch (type) {
    case 'relay':  return 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20';
    case 'srflx':  return 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20';
    case 'prflx':  return 'text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/20';
    default:       return 'text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-700/50';
  }
}

function typeLabel(type: string) {
  switch (type) {
    case 'relay':  return 'relay (TURN)';
    case 'srflx':  return 'srflx (STUN)';
    case 'prflx':  return 'prflx';
    default:       return type || 'host';
  }
}

export function IceTesterPanel({ configs }: IceTesterPanelProps) {
  const cfg = Object.fromEntries(configs.map(c => [c.key, c.value ?? '']));

  const turnServer   = cfg['turn_server']   ?? '';
  const turnUsername = cfg['turn_username'] ?? '';
  const turnCred     = cfg['turn_credential'] ?? '';
  const stunServers  = cfg['stun_servers']  ?? '';

  const hasTurn = !!(turnServer && turnUsername && turnCred);
  const hasStun = !!stunServers;

  const [status, setStatus] = useState<TestStatus>('idle');
  const [candidates, setCandidates] = useState<CandidateRow[]>([]);
  const [error, setError] = useState('');
  const [durationMs, setDurationMs] = useState<number | null>(null);
  const [policy, setPolicy] = useState<'all' | 'relay'>('all');

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const startTimeRef = useRef<number>(0);
  const counterRef = useRef(0);

  // Clean up on unmount
  useEffect(() => () => { pcRef.current?.close(); }, []);

  const stopTest = () => {
    pcRef.current?.close();
    pcRef.current = null;
    setStatus(prev => prev === 'running' ? 'done' : prev);
  };

  const runTest = async (transportPolicy: 'all' | 'relay') => {
    pcRef.current?.close();
    pcRef.current = null;
    setCandidates([]);
    setError('');
    setDurationMs(null);
    setStatus('running');
    setPolicy(transportPolicy);
    counterRef.current = 0;
    startTimeRef.current = Date.now();

    const rtcConfig = buildRTCConfigFromDB(cfg);
    rtcConfig.iceTransportPolicy = transportPolicy;

    // Must have at least one TURN server for relay policy
    if (transportPolicy === 'relay' && !hasTurn) {
      setError('برای تست TURN باید آدرس، نام کاربری و رمز TURN وارد شده باشد.');
      setStatus('error');
      return;
    }

    let pc: RTCPeerConnection;
    try {
      pc = new RTCPeerConnection(rtcConfig);
    } catch (e: any) {
      setError(e?.message ?? 'خطا در ایجاد RTCPeerConnection');
      setStatus('error');
      return;
    }
    pcRef.current = pc;

    // Timeout after 20 seconds
    const timeout = setTimeout(() => {
      if (pcRef.current === pc) {
        pc.close();
        pcRef.current = null;
        setDurationMs(Date.now() - startTimeRef.current);
        setStatus('done');
      }
    }, 20_000);

    pc.onicecandidate = (event) => {
      if (!event.candidate) {
        clearTimeout(timeout);
        setDurationMs(Date.now() - startTimeRef.current);
        setStatus('done');
        pc.close();
        pcRef.current = null;
        return;
      }
      const fields = parseCandidateFields(event.candidate);
      const now = new Date().toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      setCandidates(prev => [...prev, {
        id: counterRef.current++,
        timestamp: now,
        raw: event.candidate!.candidate,
        ...fields,
      }]);
    };

    pc.onicegatheringstatechange = () => {
      if (pc.iceGatheringState === 'complete') {
        clearTimeout(timeout);
        setDurationMs(Date.now() - startTimeRef.current);
        setStatus('done');
        pc.close();
        pcRef.current = null;
      }
    };

    pc.onicecandidateerror = (e: RTCPeerConnectionIceErrorEvent) => {
      // 701 = TURN authentication failure
      if (e.errorCode === 701) {
        setCandidates(prev => [...prev, {
          id: counterRef.current++,
          timestamp: new Date().toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
          type: 'error',
          protocol: '',
          address: e.url ?? '',
          port: String(e.errorCode),
          raw: `ERROR ${e.errorCode}: ${e.errorText ?? 'TURN authentication failed'}`,
        }]);
      }
    };

    try {
      pc.createDataChannel('ice-test');
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
    } catch (e: any) {
      clearTimeout(timeout);
      pc.close();
      pcRef.current = null;
      setError(e?.message ?? 'خطا در ایجاد offer');
      setStatus('error');
    }
  };

  const hasRelay  = candidates.some(c => c.type === 'relay');
  const hasSrflx  = candidates.some(c => c.type === 'srflx');
  const hasErrors = candidates.some(c => c.type === 'error');

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100 dark:border-gray-700">
        <Wifi className="w-4 h-4 text-teal-500 flex-shrink-0" />
        <div>
          <h4 className="font-semibold text-gray-800 dark:text-white text-sm">تست اتصال ICE (STUN / TURN)</h4>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            اگر candidate با نوع <span className="font-mono text-blue-600 dark:text-blue-400">srflx</span> یافت شود STUN کار می‌کند.
            اگر <span className="font-mono text-green-600 dark:text-green-400">relay</span> یافت شود TURN کار می‌کند.
          </p>
        </div>
      </div>

      <div className="p-5 space-y-4">
        {/* Current config summary */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-gray-50 dark:bg-gray-700/50">
            {hasStun ? <CheckCircle className="w-3.5 h-3.5 text-green-500 flex-shrink-0" /> : <AlertCircle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />}
            <span className="text-gray-600 dark:text-gray-400">STUN:</span>
            <span className="font-mono text-gray-800 dark:text-gray-200 truncate">{stunServers || 'تنظیم نشده'}</span>
          </div>
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-gray-50 dark:bg-gray-700/50">
            {hasTurn ? <CheckCircle className="w-3.5 h-3.5 text-green-500 flex-shrink-0" /> : <AlertCircle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />}
            <span className="text-gray-600 dark:text-gray-400">TURN:</span>
            <span className="font-mono text-gray-800 dark:text-gray-200 truncate">{turnServer || 'تنظیم نشده'}</span>
          </div>
          {hasTurn && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-gray-50 dark:bg-gray-700/50 sm:col-span-2">
              <CheckCircle className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
              <span className="text-gray-600 dark:text-gray-400">کاربری TURN:</span>
              <span className="font-mono text-gray-800 dark:text-gray-200">{turnUsername}</span>
              <span className="text-gray-400 mx-1">|</span>
              <span className="text-gray-600 dark:text-gray-400">رمز:</span>
              <span className="font-mono text-gray-800 dark:text-gray-200">{turnCred ? '••••••' : '—'}</span>
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => runTest('all')}
            disabled={status === 'running' || (!hasStun && !hasTurn)}
            className="flex items-center gap-2 px-4 py-2 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white rounded-xl text-sm font-medium transition"
          >
            {status === 'running' && policy === 'all'
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <Play className="w-4 h-4" />}
            تست STUN + TURN
          </button>
          <button
            onClick={() => runTest('relay')}
            disabled={status === 'running' || !hasTurn}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-sm font-medium transition"
          >
            {status === 'running' && policy === 'relay'
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <Wifi className="w-4 h-4" />}
            تست TURN فقط (relay)
          </button>
          {status === 'running' && (
            <button
              onClick={stopTest}
              className="flex items-center gap-2 px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-xl text-sm font-medium transition"
            >
              <Square className="w-4 h-4" /> توقف
            </button>
          )}
          {candidates.length > 0 && status !== 'running' && (
            <button
              onClick={() => { setCandidates([]); setStatus('idle'); setError(''); setDurationMs(null); }}
              className="flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-xl text-sm font-medium transition"
            >
              <Trash2 className="w-4 h-4" /> پاک کردن
            </button>
          )}
        </div>

        {/* Error message */}
        {status === 'error' && error && (
          <div className="flex items-start gap-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-sm text-red-700 dark:text-red-400">
            <XCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            {error}
          </div>
        )}

        {/* Candidate log */}
        {candidates.length > 0 && (
          <div className="rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700">
            <div className="bg-gray-50 dark:bg-gray-900 px-4 py-2 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 font-mono">ICE Candidates</span>
              {status === 'running' && <span className="flex items-center gap-1 text-xs text-teal-500"><Loader2 className="w-3 h-3 animate-spin" />جمع‌آوری...</span>}
              {status === 'done' && durationMs !== null && <span className="text-xs text-gray-400 font-mono">{(durationMs / 1000).toFixed(2)}s</span>}
            </div>
            <div className="divide-y divide-gray-100 dark:divide-gray-700/50 max-h-64 overflow-y-auto">
              {candidates.map(c => (
                <div key={c.id} className={`flex items-center gap-3 px-4 py-2.5 text-xs font-mono ${c.type === 'error' ? 'bg-red-50 dark:bg-red-900/10' : ''}`}>
                  <span className="text-gray-400 dark:text-gray-500 flex-shrink-0">{c.timestamp}</span>
                  <span className={`px-1.5 py-0.5 rounded text-xs font-semibold flex-shrink-0 ${c.type === 'error' ? 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400' : typeColor(c.type)}`}>
                    {c.type === 'error' ? 'error' : typeLabel(c.type)}
                  </span>
                  {c.type !== 'error' && (
                    <>
                      <span className="text-gray-600 dark:text-gray-300">{c.address}</span>
                      {c.port && <span className="text-gray-400">:{c.port}</span>}
                      {c.protocol && <span className="text-gray-400 uppercase ml-1">{c.protocol}</span>}
                    </>
                  )}
                  {c.type === 'error' && <span className="text-red-600 dark:text-red-400 truncate">{c.raw}</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Summary */}
        {status === 'done' && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div className={`flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm ${hasSrflx ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300' : 'bg-gray-50 dark:bg-gray-700/50 text-gray-500 dark:text-gray-400'}`}>
              {hasSrflx
                ? <CheckCircle className="w-4 h-4 text-blue-500 flex-shrink-0" />
                : <WifiOff className="w-4 h-4 flex-shrink-0" />}
              <span className="font-medium">STUN</span>
              <span className="text-xs">{hasSrflx ? 'کار می‌کند' : 'کار نمی‌کند'}</span>
            </div>
            <div className={`flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm ${hasRelay ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300' : 'bg-gray-50 dark:bg-gray-700/50 text-gray-500 dark:text-gray-400'}`}>
              {hasRelay
                ? <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />
                : <WifiOff className="w-4 h-4 flex-shrink-0" />}
              <span className="font-medium">TURN</span>
              <span className="text-xs">{hasRelay ? 'کار می‌کند' : 'کار نمی‌کند'}</span>
            </div>
            <div className={`flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm ${!hasErrors ? 'bg-teal-50 dark:bg-teal-900/20 text-teal-700 dark:text-teal-300' : 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300'}`}>
              {!hasErrors
                ? <CheckCircle className="w-4 h-4 text-teal-500 flex-shrink-0" />
                : <AlertCircle className="w-4 h-4 flex-shrink-0" />}
              <span className="font-medium">جمع‌آوری</span>
              <span className="text-xs">{!hasErrors ? 'بدون خطا' : 'خطای احراز هویت'}</span>
            </div>
          </div>
        )}

        {/* Running gathering hint */}
        {status === 'running' && (
          <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
            <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0" />
            در حال جمع‌آوری candidate ها... (حداکثر ۲۰ ثانیه)
          </div>
        )}

        {/* Help text */}
        {status === 'idle' && (
          <div className="text-xs text-gray-400 dark:text-gray-500 space-y-1">
            <p>• <span className="font-mono text-blue-500">srflx</span>: آدرس عمومی از طریق STUN — نشان می‌دهد STUN کار می‌کند</p>
            <p>• <span className="font-mono text-green-500">relay</span>: ترافیک از طریق TURN سرور — نشان می‌دهد TURN کار می‌کند</p>
            <p>• <span className="font-mono text-gray-400">host</span>: آدرس محلی شبکه — همیشه وجود دارد</p>
            <p>• خطای کد <span className="font-mono">701</span>: اطلاعات احراز هویت TURN اشتباه است</p>
          </div>
        )}
      </div>
    </div>
  );
}
