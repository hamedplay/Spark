import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle, Bot, Brain, Check, CheckCircle2, Loader2, Mic, RefreshCw, Send,
  Sparkles, Square, Volume2, VolumeX, X, X as XIcon, Zap,
} from 'lucide-react';
import toast from 'react-hot-toast';
import moment from 'moment-jalaali';
import { supabase } from '../../lib/supabase';
import { panelStyle, useDraggableFab } from '../../lib/useDraggableFab';
import {
  formatCommandSummary,
  parseLocal,
  requiresConfirmationByType,
  speak,
} from './SparkAssistantCommands';
import { executeCommand } from './SparkAssistantExecutor';
import type {
  ParsedCommand,
  SparkAssistantProps,
  SparkLog,
  SparkMemory,
  SparkMessage,
} from './SparkAssistantTypes';

export function SparkAssistant({
  currentUserId, onNavigate, onSetCalendarView, onNewLogEntry, onOpenMeetingForm,
  onOpenCalendarMeetingForm, onNavigateToDate,
  externalCommand, onExternalCommandConsumed,
}: SparkAssistantProps) {
  const sparkFabSize = 38;
  const { pos: fabPos, onDragStart, wasDragged } = useDraggableFab('spark-fab-pos', 'left', sparkFabSize);
  const [open, setOpen] = useState(false);
  const [inputText, setInputText] = useState('');
  const [messages, setMessages] = useState<SparkMessage[]>([]);
  const [listening, setListening] = useState<'off' | 'recording'>('off');
  const [processing, setProcessing] = useState(false);
  const [muted, setMuted] = useState(false);
  const [pulse, setPulse] = useState(false);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [memory, setMemory] = useState<SparkMemory[]>([]);
  const [configsLoaded, setConfigsLoaded] = useState(false);
  const [pendingConfirmCmd, setPendingConfirmCmd] = useState<ParsedCommand | null>(null);
  const [pendingConfirmMsgId, setPendingConfirmMsgId] = useState<string | null>(null);

  const transcriptRef = useRef('');
  const recognitionRef = useRef<any>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const loadSettings = useCallback(async () => {
    const [{ data: aiConfig }, { data: storedMemory }] = await Promise.all([
      supabase.from('spark_ai_settings').select('enabled, api_key').maybeSingle(),
      supabase.from('spark_memory').select('key, value').eq('user_id', currentUserId).order('usage_count', { ascending: false }).limit(20),
    ]);
    setAiEnabled((aiConfig?.enabled === true) && !!aiConfig?.api_key?.trim());
    setMemory((storedMemory || []) as SparkMemory[]);
    setConfigsLoaded(true);
  }, [currentUserId]);

  useEffect(() => { loadSettings(); }, [loadSettings]);
  useEffect(() => { if (open) loadSettings(); }, [open, loadSettings]);

  useEffect(() => {
    if (!externalCommand || !configsLoaded) return;
    setOpen(true);
    const timeout = setTimeout(() => {
      handleCommand(externalCommand);
      onExternalCommandConsumed?.();
    }, 400);
    return () => clearTimeout(timeout);
  }, [externalCommand, configsLoaded]);

  useEffect(() => {
    const interval = setInterval(() => setPulse(value => !value), 3000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (open && messages.length === 0) {
      const greeting = aiEnabled
        ? '🤖 سلام! اسپارک AI آماده است.\n\n⚠️ توجه: قبل از هر اقدام مهم (ارسال پیام، ایجاد جلسه، لغو و ...) از شما تأیید می‌گیرم.\n\nدستور خود را بگویید.'
        : '🤖 سلام! اسپارک آماده است.\n\n⚠️ توجه: قبل از هر اقدام مهم از شما تأیید می‌گیرم.\n\nدستور خود را بگویید.';
      addMsg('spark', greeting);
      if (!muted) setTimeout(() => speak(greeting), 300);
    }
  }, [open]);

  const addMsg = (role: 'spark' | 'user', text: string, status?: SparkMessage['status'], pendingCommand?: ParsedCommand | null) => {
    setMessages(previous => [...previous, { id: `${Date.now()}_${Math.random()}`, role, text, status, pendingCommand }]);
  };

  const updateLastSparkMsg = (status: SparkMessage['status'], text?: string) => {
    setMessages(previous => {
      const next = [...previous];
      let last = -1;
      for (let index = next.length - 1; index >= 0; index--) {
        if (next[index].role === 'spark') { last = index; break; }
      }
      if (last >= 0) next[last] = { ...next[last], status, ...(text ? { text } : {}) };
      return next;
    });
  };

  const logCmd = async (raw: string, type: string, payload: any): Promise<string | null> => {
    try {
      const { data } = await supabase.from('spark_assistant_logs').insert({
        user_id: currentUserId,
        command_text: raw,
        command_type: type,
        status: 'pending',
        payload,
      }).select().maybeSingle();
      return data?.id || null;
    } catch {
      return null;
    }
  };

  const finishLog = async (id: string | null, status: 'pending' | 'done' | 'failed', summary: string, errorMessage?: string) => {
    if (!id) return;
    const { data } = await supabase.from('spark_assistant_logs').update({
      status,
      result_summary: summary,
      error_message: errorMessage || null,
    }).eq('id', id).select().maybeSingle();
    if (data && onNewLogEntry) onNewLogEntry(data as SparkLog);
  };

  const callAI = async (rawText: string): Promise<ParsedCommand | null> => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return null;
      const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/spark-ai`;
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
          Apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({
          command: rawText,
          todayDate: moment().format('jYYYY/jMM/jDD'),
          conversationHistory: messages.slice(-8).map(message => ({ role: message.role, text: message.text })),
          memory,
        }),
      });
      if (!response.ok) {
        console.error('AI call failed with status:', response.status);
        return null;
      }
      const data = await response.json();
      if (data.error === 'AI_NOT_CONFIGURED') {
        await loadSettings();
        return null;
      }
      if (data.error) throw new Error(data.error);
      const command = data as ParsedCommand;
      command.requiresConfirmation = requiresConfirmationByType(command.type);
      return command;
    } catch (error) {
      console.error('AI call failed:', error);
      return null;
    }
  };

  const confirmCommand = async (confirmed: boolean) => {
    if (!pendingConfirmCmd || !pendingConfirmMsgId) {
      setPendingConfirmCmd(null);
      setPendingConfirmMsgId(null);
      setProcessing(false);
      return;
    }

    const command = pendingConfirmCmd;
    const messageId = pendingConfirmMsgId;
    setPendingConfirmCmd(null);
    setPendingConfirmMsgId(null);

    if (!confirmed) {
      setMessages(previous => previous.map(message =>
        message.id === messageId ? { ...message, status: 'failed', text: '❌ دستور لغو شد. هیچ اقدامی انجام نشد.' } : message,
      ));
      if (!muted) speak('دستور لغو شد.');
      setProcessing(false);
      return;
    }

    setMessages(previous => previous.map(message =>
      message.id === messageId ? { ...message, status: 'executing', text: '⏳ در حال اجرا...' } : message,
    ));

    try {
      const result = await executeCommand(command, currentUserId, onNavigate, onSetCalendarView, onOpenMeetingForm, onOpenCalendarMeetingForm, onNavigateToDate);
      setMessages(previous => previous.map(message =>
        message.id === messageId ? { ...message, status: result.success ? 'done' : 'failed', text: result.message } : message,
      ));
      if (!muted) speak(result.message.split('\n')[0]);
    } catch (error: any) {
      const errorMessage = '❌ خطا: ' + (error?.message || 'نامشخص');
      setMessages(previous => previous.map(message =>
        message.id === messageId ? { ...message, status: 'failed', text: errorMessage } : message,
      ));
      if (!muted) speak('خطایی رخ داد.');
    }

    setProcessing(false);
  };

  const handleCommand = useCallback(async (rawText: string) => {
    if (!rawText.trim() || processing) return;
    addMsg('user', rawText);
    setInputText('');
    setProcessing(true);
    addMsg('spark', aiEnabled ? '🤖 هوش مصنوعی در حال تحلیل...' : '📝 در حال تحلیل...', 'executing');
    const logId = await logCmd(rawText, 'processing', { raw: rawText });

    let command: ParsedCommand;
    let usedAI = false;
    try {
      if (aiEnabled) {
        const aiResult = await callAI(rawText);
        if (aiResult) {
          command = aiResult;
          usedAI = true;
        } else {
          command = parseLocal(rawText);
        }
      } else {
        command = parseLocal(rawText);
      }
    } catch {
      command = parseLocal(rawText);
    }

    if (command.requiresConfirmation === undefined) {
      command.requiresConfirmation = requiresConfirmationByType(command.type);
    }

    if (command.type === 'clarification') {
      const question = command.question || command.response || 'اطلاعات بیشتری لازم است. لطفاً واضح‌تر بگویید.';
      updateLastSparkMsg('pending', question);
      if (!muted) speak(question);
      await finishLog(logId, 'pending', question);
      setProcessing(false);
      return;
    }

    if (command.type === 'unknown') {
      const response = usedAI
        ? (command.response || '❌ متوجه نشدم. سوال یا دستور خود را واضح‌تر بیان کنید.')
        : '❌ دستور را متوجه نشدم. دوباره با جزئیات بیشتر بگویید.';
      updateLastSparkMsg('failed', response);
      if (!muted) speak('متوجه نشدم.');
      await finishLog(logId, 'failed', 'unknown');
      setProcessing(false);
      return;
    }

    if (command.requiresConfirmation === true) {
      const summary = formatCommandSummary(command);
      const confirmMessage = `🔐 **تأیید لازم است**\n\n${summary}\n\n━━━━━━━━━━━━━━━━━━━━\nآیا برای اجرا مطمئن هستید؟`;
      const newMessageId = `${Date.now()}_${Math.random()}`;
      setMessages(previous => {
        const next = [...previous];
        let last = -1;
        for (let index = next.length - 1; index >= 0; index--) {
          if (next[index].role === 'spark') { last = index; break; }
        }
        if (last >= 0) next[last] = { ...next[last], status: 'pending', text: command.response || 'تحلیل شد.' };
        return [...next, { id: newMessageId, role: 'spark', text: confirmMessage, status: 'waiting_confirm', pendingCommand: command }];
      });
      setPendingConfirmCmd(command);
      setPendingConfirmMsgId(newMessageId);
      if (!muted) speak('لطفاً تأیید کنید.');
      await finishLog(logId, 'pending', 'awaiting confirmation');
      setProcessing(false);
      return;
    }

    try {
      const result = await executeCommand(command, currentUserId, onNavigate, onSetCalendarView, onOpenMeetingForm, onOpenCalendarMeetingForm, onNavigateToDate);
      updateLastSparkMsg(result.success ? 'done' : 'failed', result.message);
      if (!muted) speak(result.message.split('\n')[0]);
      await finishLog(logId, result.success ? 'done' : 'failed', result.message);
    } catch (error: any) {
      const errorMessage = '❌ خطا: ' + (error?.message || 'نامشخص');
      updateLastSparkMsg('failed', errorMessage);
      if (!muted) speak('خطایی رخ داد.');
      await finishLog(logId, 'failed', '', error?.message);
    }

    setProcessing(false);
  }, [processing, currentUserId, onNavigate, onSetCalendarView, onOpenMeetingForm, onOpenCalendarMeetingForm, onNavigateToDate, muted, aiEnabled, memory, messages]);

  const startRecording = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      toast.error('مرورگر از تشخیص صدا پشتیبانی نمی‌کند');
      return;
    }
    transcriptRef.current = '';
    const recognition = new SpeechRecognition();
    recognition.lang = 'fa-IR';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onstart = () => setListening('recording');
    recognition.onresult = (event: any) => {
      let final = '';
      for (let index = 0; index < event.results.length; index++) {
        if (event.results[index].isFinal) final += event.results[index][0].transcript + ' ';
      }
      transcriptRef.current = final.trim();
      setInputText(final.trim() || event.results[event.results.length - 1][0].transcript);
    };
    recognition.onerror = (event: any) => {
      setListening('off');
      if (event.error !== 'aborted') addMsg('spark', '❌ خطا در تشخیص صدا.', 'failed');
    };
    recognition.onend = () => {
      setListening('off');
      if (transcriptRef.current.trim()) handleCommand(transcriptRef.current.trim());
    };
    recognitionRef.current = recognition;
    recognition.start();
  };

  const stopRecording = () => recognitionRef.current?.stop();
  const toggleListening = () => { if (listening === 'recording') stopRecording(); else startRecording(); };
  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (inputText.trim() && !processing) handleCommand(inputText);
  };

  const renderMessage = (message: SparkMessage) => {
    if (message.role === 'spark' && message.status === 'waiting_confirm' && message.pendingCommand) {
      return (
        <div className="max-w-[95%]">
          <div className="flex items-end gap-2">
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-sky-400 to-blue-600 flex items-center justify-center flex-shrink-0 mb-0.5">
              {aiEnabled ? <Brain className="w-3.5 h-3.5 text-white" /> : <Bot className="w-3.5 h-3.5 text-white" />}
            </div>
            <div className="px-4 py-3 rounded-2xl rounded-br-sm text-sm shadow-md bg-amber-50 dark:bg-amber-900/20 border-2 border-amber-300 dark:border-amber-700 max-w-full">
              <div className="whitespace-pre-line text-gray-800 dark:text-gray-200 mb-3 font-mono text-xs md:text-sm">{message.text}</div>
              <div className="flex gap-3 mt-2">
                <button onClick={() => confirmCommand(true)} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold rounded-xl flex items-center gap-2 transition-all shadow-md"><Check className="w-4 h-4" /> بله، اجرا کن</button>
                <button onClick={() => confirmCommand(false)} className="px-4 py-2 bg-gray-400 hover:bg-gray-500 dark:bg-gray-600 dark:hover:bg-gray-700 text-white text-sm font-bold rounded-xl flex items-center gap-2 transition-all shadow-md"><XIcon className="w-4 h-4" /> لغو</button>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className={`flex ${message.role === 'user' ? 'justify-start' : 'justify-end'}`}>
        {message.role === 'spark' && (
          <div className="flex items-end gap-2 max-w-[92%]">
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-sky-400 to-blue-600 flex items-center justify-center flex-shrink-0 mb-0.5">
              {aiEnabled ? <Brain className="w-3.5 h-3.5 text-white" /> : <Bot className="w-3.5 h-3.5 text-white" />}
            </div>
            <div className={`px-3 py-2 rounded-2xl rounded-br-sm text-sm shadow-sm leading-relaxed ${message.status === 'failed'
              ? 'bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800'
              : message.status === 'done'
                ? 'bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 border border-emerald-200 dark:border-emerald-800'
                : message.status === 'executing'
                  ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800'
                  : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-100'}`}>
              <div className="flex items-start gap-1.5">
                {message.status === 'done' && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0 mt-0.5" />}
                {message.status === 'failed' && <AlertCircle className="w-3.5 h-3.5 text-red-500 flex-shrink-0 mt-0.5" />}
                {message.status === 'executing' && <Loader2 className="w-3.5 h-3.5 text-blue-500 flex-shrink-0 mt-0.5 animate-spin" />}
                <span className="whitespace-pre-line">{message.text}</span>
              </div>
            </div>
          </div>
        )}
        {message.role === 'user' && (
          <div className="max-w-[80%] px-3 py-2 rounded-2xl rounded-bl-sm text-sm text-white leading-relaxed" style={{ background: 'linear-gradient(135deg,#0ea5e9,#2563eb)' }}>
            {message.text}
          </div>
        )}
      </div>
    );
  };

  const suggestions = [
    '📅 جلسات امروز چیه؟',
    '➕ یک جلسه بزار با موضوع هماهنگی قرارداد',
    '💬 یک پیام بده به احمدی با موضوع پیگیری پروژه',
    '📋 اقدام ایجاد کن با عنوان بررسی گزارش ماهانه',
    '❌ جلسه تست را لغو کن',
    '⏰ جلسه هماهنگی را ۳۰ دقیقه جلو بنداز',
  ];

  const statusLabel = listening === 'recording' ? '🎙️ در حال ضبط...'
    : processing ? (aiEnabled ? '🧠 هوش مصنوعی پردازش می‌کند...' : '⚙️ پردازش...')
      : aiEnabled ? '🤖 AI فعال' : '✅ آنلاین';

  return (
    <>
      <button
        onMouseDown={onDragStart}
        onTouchStart={onDragStart}
        onClick={() => { if (!wasDragged()) setOpen(true); }}
        className={`fixed z-[60] rounded-full shadow-xl flex items-center justify-center transition-all duration-200 select-none ${open ? 'scale-0 opacity-0 pointer-events-none' : 'opacity-80 hover:opacity-100 hover:scale-105'}`}
        style={{
          top: fabPos.y,
          left: fabPos.x,
          width: sparkFabSize,
          height: sparkFabSize,
          background: 'linear-gradient(135deg,#0ea5e9,#2563eb)',
          boxShadow: pulse ? '0 0 0 8px rgba(14,165,233,0.15),0 6px 20px rgba(37,99,235,0.4)' : '0 6px 20px rgba(37,99,235,0.3)',
          cursor: 'grab',
          touchAction: 'none',
        }}
        title="اسپارک"
      >
        <Bot className="w-[18px] h-[18px] text-white pointer-events-none" />
        <span className={`absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white animate-pulse ${aiEnabled ? 'bg-yellow-400' : 'bg-emerald-400'}`} />
      </button>

      {open && (
        <div
          className="fixed z-[60] w-[460px] max-w-[calc(100vw-1.5rem)] rounded-3xl shadow-2xl flex flex-col overflow-hidden"
          style={{ ...panelStyle(fabPos, 460, 620, sparkFabSize), height: '620px', boxShadow: '0 24px 64px rgba(0,0,0,0.22)' }}
          dir="rtl"
        >
          <div className="flex items-center justify-between px-4 py-3 flex-shrink-0" style={{ background: 'linear-gradient(135deg,#0ea5e9,#2563eb)' }}>
            <div className="flex items-center gap-3">
              <div className={`w-9 h-9 rounded-full flex items-center justify-center ${listening === 'recording' ? 'bg-red-500 animate-pulse' : 'bg-white/20'}`}>
                {aiEnabled ? <Brain className="w-5 h-5 text-white" /> : <Bot className="w-5 h-5 text-white" />}
              </div>
              <div>
                <p className="font-bold text-white text-sm flex items-center gap-1.5">اسپارک {aiEnabled ? <Zap className="w-3 h-3 text-yellow-300" /> : <Sparkles className="w-3 h-3 text-yellow-300" />}</p>
                <p className="text-[11px] text-blue-100">{statusLabel}</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => { loadSettings(); toast.success('بارگذاری شد'); }} className="w-7 h-7 rounded-full bg-white/15 hover:bg-white/25 flex items-center justify-center text-white transition-colors"><RefreshCw className="w-3.5 h-3.5" /></button>
              <button onClick={() => setMuted(value => !value)} className="w-7 h-7 rounded-full bg-white/15 hover:bg-white/25 flex items-center justify-center text-white transition-colors">{muted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}</button>
              <button onClick={() => { setOpen(false); window.speechSynthesis?.cancel(); recognitionRef.current?.stop(); }} className="w-7 h-7 rounded-full bg-white/15 hover:bg-white/25 flex items-center justify-center text-white transition-colors"><X className="w-4 h-4" /></button>
            </div>
          </div>

          {listening === 'recording' && (
            <div className="flex items-center gap-2 px-4 py-2 bg-red-50 dark:bg-red-900/30 border-b border-red-200 dark:border-red-800 flex-shrink-0">
              <div className="flex gap-0.5 items-end">{[6, 10, 14, 10, 6].map((height, index) => <div key={index} className="w-1 bg-red-500 rounded-full animate-bounce" style={{ height, animationDelay: `${index * 0.12}s` }} />)}</div>
              <span className="text-xs text-red-700 dark:text-red-300 font-medium flex-1">🎙️ در حال ضبط... دستور کامل خود را بگویید، سپس توقف را بزنید</span>
              <button onClick={stopRecording} className="px-2.5 py-1 bg-red-500 hover:bg-red-600 text-white text-xs font-bold rounded-lg flex items-center gap-1"><Square className="w-3 h-3" /> توقف</button>
            </div>
          )}

          <div className="flex-1 overflow-y-auto p-3 space-y-3 bg-gray-50 dark:bg-gray-900">
            {messages.map(message => <React.Fragment key={message.id}>{renderMessage(message)}</React.Fragment>)}
            {processing && messages[messages.length - 1]?.status !== 'executing' && messages[messages.length - 1]?.status !== 'waiting_confirm' && (
              <div className="flex items-end gap-2">
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-sky-400 to-blue-600 flex items-center justify-center"><Bot className="w-3.5 h-3.5 text-white" /></div>
                <div className="px-3 py-2 rounded-2xl bg-white dark:bg-gray-800 flex items-center gap-2 text-gray-400 text-sm shadow-sm"><Loader2 className="w-3.5 h-3.5 animate-spin" /> در حال پردازش...</div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {messages.length <= 1 && (
            <div className="px-3 pb-2 flex-shrink-0 bg-gray-50 dark:bg-gray-900">
              <p className="text-[10px] text-gray-400 mb-1.5 font-medium">✨ نمونه دستورات:</p>
              <div className="flex flex-wrap gap-1.5">
                {suggestions.map(suggestion => (
                  <button key={suggestion} onClick={() => handleCommand(suggestion)} className="text-[11px] px-2.5 py-1 rounded-full bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 border border-blue-100 dark:border-blue-800 hover:bg-blue-100 transition-colors truncate max-w-[200px]" title={suggestion}>
                    {suggestion.length > 35 ? suggestion.slice(0, 35) + '...' : suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="flex items-center gap-2 px-3 py-3 border-t border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 flex-shrink-0">
            <button type="button" onClick={toggleListening} disabled={processing} className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 transition-all disabled:opacity-40 ${listening === 'recording' ? 'bg-red-500 hover:bg-red-600 text-white shadow-lg' : 'bg-gray-100 dark:bg-gray-700 text-gray-500 hover:bg-blue-50 hover:text-blue-500'}`}>
              {listening === 'recording' ? <Square className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </button>
            <input type="text" value={inputText} onChange={event => setInputText(event.target.value)} placeholder={listening === 'recording' ? '🎙️ در حال ضبط...' : aiEnabled ? '🤖 هر دستوری بدید...' : '✏️ دستور متنی یا صوتی...'} disabled={processing} dir="rtl" className="flex-1 px-3 py-2 text-sm bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl text-gray-800 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-50" />
            <button type="submit" disabled={!inputText.trim() || processing || listening === 'recording'} className="w-10 h-10 rounded-full bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white flex items-center justify-center flex-shrink-0 transition-colors">
              {processing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          </form>
        </div>
      )}
    </>
  );
}
