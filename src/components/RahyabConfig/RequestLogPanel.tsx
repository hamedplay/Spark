import { useState } from 'react';
import { RefreshCw, Terminal, ChevronDown, ChevronUp, Copy } from 'lucide-react';
import type { DebugLog } from './types';

function statusColor(code?: number) {
  if (!code) return 'text-gray-400';
  if (code >= 500) return 'text-red-400';
  if (code >= 400) return 'text-orange-400';
  if (code >= 200) return 'text-green-400';
  return 'text-gray-400';
}

function statusBg(code?: number) {
  if (!code) return 'bg-gray-800 text-gray-400';
  if (code >= 500) return 'bg-red-900/60 text-red-300';
  if (code >= 400) return 'bg-orange-900/60 text-orange-300';
  return 'bg-green-900/60 text-green-300';
}

export function RequestLogPanel({ logs, onClear }: { logs: DebugLog[]; onClear: () => void }) {
  const [openIdx, setOpenIdx] = useState<number>(0);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [showRespHeaders, setShowRespHeaders] = useState<Record<number, boolean>>({});

  const copy = (text: string, key: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1500);
    });
  };

  const buildRequestText = (log: DebugLog) =>
    `POST ${log.url}\n\nHeaders:\n${JSON.stringify(log.requestHeaders, null, 2)}\n\nBody:\n${log.requestBody}`;

  const buildResponseText = (log: DebugLog) =>
    `Status: ${log.responseStatus ?? 'N/A'}\n\nHeaders:\n${JSON.stringify(log.responseHeaders ?? {}, null, 2)}\n\nBody:\n${log.responseBody ?? log.error ?? ''}`;

  if (!logs.length) return null;

  const reversed = [...logs].reverse();

  return (
    <div className="rounded-2xl border border-gray-700 dark:border-gray-800 overflow-hidden" dir="ltr">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2.5 bg-gray-900 border-b border-gray-700 dark:border-gray-800">
        <Terminal className="w-4 h-4 text-teal-400 flex-shrink-0" />
        <span className="text-xs font-bold text-teal-400 tracking-widest uppercase">SMS Debug Console</span>
        <span className="ml-2 text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded-full">{logs.length}</span>
        <button
          onClick={onClear}
          className="ml-auto flex items-center gap-1.5 text-xs text-gray-500 hover:text-red-400 transition-colors px-2 py-1 rounded-lg hover:bg-gray-800"
        >
          <RefreshCw className="w-3 h-3" />
          Clear All
        </button>
      </div>

      {/* Log entries (latest first) */}
      <div className="bg-gray-900 divide-y divide-gray-800">
        {reversed.map((log, i) => {
          const origIdx = logs.length - 1 - i;
          const isOpen = openIdx === origIdx;
          const hasError = !!log.error;
          const ts = log.requestTimestamp ? new Date(log.requestTimestamp).toLocaleTimeString('fa-IR') : '';

          return (
            <div key={origIdx}>
              {/* Row header */}
              <button
                onClick={() => setOpenIdx(isOpen ? -1 : origIdx)}
                className="w-full flex items-center gap-2.5 px-4 py-3 hover:bg-gray-800/70 transition-colors text-left"
              >
                <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded ${hasError ? 'bg-red-900/60 text-red-400' : 'bg-green-900/60 text-green-400'}`}>
                  {hasError ? 'ERR' : 'OK'}
                </span>
                <span className="text-xs font-mono text-gray-200 font-semibold">{log.soapAction}</span>
                {log.responseStatus && (
                  <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded font-bold ${statusBg(log.responseStatus)}`}>
                    {log.responseStatus}
                  </span>
                )}
                {ts && <span className="text-[10px] text-gray-600 font-mono">{ts}</span>}
                {log.durationMs !== undefined && (
                  <span className="text-[10px] text-gray-500 font-mono">{log.durationMs}ms</span>
                )}
                <span className="text-[10px] text-gray-600 truncate flex-1 font-mono">{log.url}</span>
                {isOpen ? <ChevronUp className="w-3.5 h-3.5 text-gray-600 flex-shrink-0" /> : <ChevronDown className="w-3.5 h-3.5 text-gray-600 flex-shrink-0" />}
              </button>

              {/* Expanded detail */}
              {isOpen && (
                <div className="px-4 pb-5 space-y-4 bg-gray-950/50">

                  {/* ── REQUEST ── */}
                  <div className="border border-gray-700/60 rounded-xl overflow-hidden">
                    <div className="flex items-center justify-between px-3 py-2 bg-gray-800/80 border-b border-gray-700/60">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold text-blue-400 bg-blue-900/40 px-2 py-0.5 rounded font-mono">POST</span>
                        <span className="text-xs font-semibold text-gray-300 uppercase tracking-wide">Request</span>
                      </div>
                      <button
                        onClick={() => copy(buildRequestText(log), `req-${origIdx}`)}
                        className="flex items-center gap-1 text-[10px] text-gray-500 hover:text-gray-300 transition-colors"
                      >
                        <Copy className="w-3 h-3" />
                        {copiedKey === `req-${origIdx}` ? 'Copied!' : 'Copy Request'}
                      </button>
                    </div>
                    <div className="p-3 space-y-3">
                      {/* URL + meta */}
                      <div className="space-y-1">
                        <div className="flex gap-2 text-xs font-mono">
                          <span className="text-gray-500 flex-shrink-0 w-20">URL</span>
                          <span className="text-teal-300 break-all">{log.url}</span>
                        </div>
                        {log.requestTimestamp && (
                          <div className="flex gap-2 text-xs font-mono">
                            <span className="text-gray-500 flex-shrink-0 w-20">Timestamp</span>
                            <span className="text-gray-400">{log.requestTimestamp}</span>
                          </div>
                        )}
                        {log.durationMs !== undefined && (
                          <div className="flex gap-2 text-xs font-mono">
                            <span className="text-gray-500 flex-shrink-0 w-20">Duration</span>
                            <span className={`font-semibold ${log.durationMs > 5000 ? 'text-red-400' : log.durationMs > 2000 ? 'text-yellow-400' : 'text-green-400'}`}>{log.durationMs} ms</span>
                          </div>
                        )}
                      </div>
                      {/* Request Headers */}
                      <div>
                        <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5">Headers</p>
                        <div className="bg-gray-800 rounded-lg p-2.5 space-y-1">
                          {Object.entries(log.requestHeaders).map(([k, v]) => (
                            <div key={k} className="flex gap-2 text-xs font-mono">
                              <span className="text-purple-400 flex-shrink-0">{k}:</span>
                              <span className="text-gray-300 break-all">{v}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                      {/* Request Body */}
                      <div>
                        <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5">Request Body</p>
                        <pre className="bg-gray-800 rounded-lg p-2.5 text-[11px] font-mono text-green-300 overflow-x-auto whitespace-pre-wrap break-all leading-relaxed max-h-56 overflow-y-auto">
                          {log.requestBody}
                        </pre>
                      </div>
                    </div>
                  </div>

                  {/* ── RESPONSE ── */}
                  <div className="border border-gray-700/60 rounded-xl overflow-hidden">
                    <div className="flex items-center justify-between px-3 py-2 bg-gray-800/80 border-b border-gray-700/60">
                      <div className="flex items-center gap-2">
                        {log.responseStatus ? (
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded font-mono ${statusBg(log.responseStatus)}`}>{log.responseStatus}</span>
                        ) : (
                          <span className="text-[10px] font-bold text-gray-500 bg-gray-800 px-2 py-0.5 rounded font-mono">N/A</span>
                        )}
                        <span className="text-xs font-semibold text-gray-300 uppercase tracking-wide">Response</span>
                      </div>
                      <button
                        onClick={() => copy(buildResponseText(log), `res-${origIdx}`)}
                        className="flex items-center gap-1 text-[10px] text-gray-500 hover:text-gray-300 transition-colors"
                      >
                        <Copy className="w-3 h-3" />
                        {copiedKey === `res-${origIdx}` ? 'Copied!' : 'Copy Response'}
                      </button>
                    </div>
                    <div className="p-3 space-y-3">
                      {/* Response Status line */}
                      {log.responseStatus && (
                        <div className="flex gap-2 text-xs font-mono">
                          <span className="text-gray-500 flex-shrink-0 w-20">Status</span>
                          <span className={`font-bold ${statusColor(log.responseStatus)}`}>{log.responseStatus}</span>
                        </div>
                      )}
                      {/* Response Headers (collapsible) */}
                      {log.responseHeaders && Object.keys(log.responseHeaders).length > 0 && (
                        <div>
                          <button
                            onClick={() => setShowRespHeaders(p => ({ ...p, [origIdx]: !p[origIdx] }))}
                            className="flex items-center gap-1.5 text-[10px] text-gray-500 uppercase tracking-wider hover:text-gray-300 transition-colors mb-1.5"
                          >
                            {showRespHeaders[origIdx] ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                            Response Headers ({Object.keys(log.responseHeaders).length})
                          </button>
                          {showRespHeaders[origIdx] && (
                            <div className="bg-gray-800 rounded-lg p-2.5 space-y-1">
                              {Object.entries(log.responseHeaders).map(([k, v]) => (
                                <div key={k} className="flex gap-2 text-xs font-mono">
                                  <span className="text-purple-400 flex-shrink-0">{k}:</span>
                                  <span className="text-gray-300 break-all">{v}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                      {/* Response Body / Error */}
                      {(log.responseBody || log.error) && (
                        <div>
                          <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5">
                            {log.error && !log.responseBody ? 'Error' : 'Body'}
                          </p>
                          <pre className={`bg-gray-800 rounded-lg p-2.5 text-[11px] font-mono overflow-x-auto whitespace-pre-wrap break-all leading-relaxed max-h-56 overflow-y-auto ${log.error && !log.responseBody ? 'text-red-400' : 'text-blue-300'}`}>
                            {log.responseBody || log.error}
                          </pre>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* ── PARSED ── */}
                  {log.parsedResult && (
                    <div className="border border-gray-700/60 rounded-xl overflow-hidden">
                      <div className="px-3 py-2 bg-gray-800/80 border-b border-gray-700/60">
                        <span className="text-xs font-semibold text-gray-300 uppercase tracking-wide">Parsed Result</span>
                      </div>
                      <div className="p-3">
                        <pre className="text-[11px] font-mono text-yellow-300 whitespace-pre-wrap break-all leading-relaxed">
                          {log.parsedResult}
                        </pre>
                      </div>
                    </div>
                  )}

                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
