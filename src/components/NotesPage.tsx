import React, { useState, useEffect, useRef } from 'react';
import { Plus, Search, CreditCard as Edit2, Save, X, Mic, Share2, Archive, Download, FileText, Image, Video, File, Trash2, Send, User, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';
import { usePermissions } from '../context/PermissionsContext';
import { toPng } from 'html-to-image';
import { useOrgUsers } from '../lib/useOrgUsers';

// Pastel note colors cycling deterministically by index
const NOTE_COLORS = [
  { bg: 'bg-yellow-50 dark:bg-yellow-900/20', border: 'border-yellow-200 dark:border-yellow-700/50', header: 'bg-yellow-100/60 dark:bg-yellow-800/30' },
  { bg: 'bg-blue-50 dark:bg-blue-900/20', border: 'border-blue-200 dark:border-blue-700/50', header: 'bg-blue-100/60 dark:bg-blue-800/30' },
  { bg: 'bg-green-50 dark:bg-green-900/20', border: 'border-green-200 dark:border-green-700/50', header: 'bg-green-100/60 dark:bg-green-800/30' },
  { bg: 'bg-pink-50 dark:bg-pink-900/20', border: 'border-pink-200 dark:border-pink-700/50', header: 'bg-pink-100/60 dark:bg-pink-800/30' },
  { bg: 'bg-purple-50 dark:bg-purple-900/20', border: 'border-purple-200 dark:border-purple-700/50', header: 'bg-purple-100/60 dark:bg-purple-800/30' },
  { bg: 'bg-orange-50 dark:bg-orange-900/20', border: 'border-orange-200 dark:border-orange-700/50', header: 'bg-orange-100/60 dark:bg-orange-800/30' },
];

interface Note {
  id: string;
  title: string;
  content: string;
  note_type: 'text' | 'voice';
  created_at: string;
  user_id: string;
  status: 'active' | 'archived';
  file_url?: string;
  file_type?: string;
  file_name?: string;
  file_size?: number;
}

export function NotesPage({ currentUserId: propUserId }: { currentUserId?: string | null }) {
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('notes_create');
  const canEdit = hasPermission('notes_edit');
  const canDelete = hasPermission('notes_delete');
  const [notes, setNotes] = useState<Note[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [isFormRecording, setIsFormRecording] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [userId, setUserId] = useState<string | null>(propUserId ?? null);
  const [voiceTranscript, setVoiceTranscript] = useState('');
  const [formVoiceTranscript, setFormVoiceTranscript] = useState('');
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingNote, setEditingNote] = useState<Note | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'archived'>('active');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [hasRecordingPermission, setHasRecordingPermission] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [shareNote, setShareNote] = useState<Note | null>(null);
  const [shareImageData, setShareImageData] = useState<string | null>(null);
  const [shareMenuNoteId, setShareMenuNoteId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [assignNote, setAssignNote] = useState<Note | null>(null);
  const [assignSearch, setAssignSearch] = useState('');
  const [expandedNoteId, setExpandedNoteId] = useState<string | null>(null);
  const { allUsers: orgUsers } = useOrgUsers(userId);
  const [newNote, setNewNote] = useState({
    title: '',
    content: ''
  });
  
  const recognitionRef = useRef<any>(null);
  const formRecognitionRef = useRef<any>(null);
  const lastResultRef = useRef<string>('');
  const finalTranscriptRef = useRef<string>('');
  const formLastResultRef = useRef<string>('');
  const formFinalTranscriptRef = useRef<string>('');
  const brandedCardRef = useRef<HTMLDivElement>(null);
  const shareMenuRef = useRef<HTMLDivElement>(null);

  // Close share dropdown on outside click
  useEffect(() => {
    if (!shareMenuNoteId) return;
    const handler = (e: MouseEvent) => {
      if (shareMenuRef.current && !shareMenuRef.current.contains(e.target as Node)) {
        setShareMenuNoteId(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [shareMenuNoteId]);

  const getFileIcon = (fileType: string) => {
    switch (fileType) {
      case 'image':
        return <Image className="w-5 h-5" />;
      case 'pdf':
        return <FileText className="w-5 h-5" />;
      case 'video':
        return <Video className="w-5 h-5" />;
      default:
        return <File className="w-5 h-5" />;
    }
  };

  const formatFileSize = (bytes: number) => {
    if (!bytes) return '';
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    return `${size.toFixed(1)} ${units[unitIndex]}`;
  };

  const handleFileClick = (note: Note) => {
    if (!note.file_url) return;

    if (note.file_type === 'image') {
      window.open(note.file_url, '_blank');
    } else {
      const link = document.createElement('a');
      link.href = note.file_url;
      link.download = note.file_name || 'download';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  useEffect(() => {
    if (!propUserId) {
      supabase.auth.getUser().then(({ data: { user } }) => {
        if (user) setUserId(user.id);
      });
    }
  }, []);

  const requestRecordingPermission = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(track => track.stop());
      setHasRecordingPermission(true);
      return true;
    } catch (error) {
      console.error('Error requesting recording permission:', error);
      setHasRecordingPermission(false);
      toast.error('لطفاً دسترسی میکروفون را فعال کنید');
      return false;
    }
  };

  const handleShareImage = async (note: Note) => {
    setShareMenuNoteId(null);
    try {
      setLoading(true);
      setShareNote(note);
      setShareImageData(null);
      await new Promise(r => setTimeout(r, 80));
      if (!brandedCardRef.current) { toast.error('خطا در ایجاد تصویر یادداشت'); return; }
      const imageData = await toPng(brandedCardRef.current, { quality: 1, pixelRatio: 2, backgroundColor: '#1e3a5f' });

      if (navigator.share && navigator.canShare?.({ files: [new File([], 'note.png', { type: 'image/png' })] })) {
        const blob = await (await fetch(imageData)).blob();
        const file = new File([blob], 'note.png', { type: 'image/png' });
        await navigator.share({ title: note.title, files: [file] });
        toast.success('یادداشت با موفقیت به اشتراک گذاشته شد');
        setShareNote(null);
      } else {
        setShareImageData(imageData);
      }
    } catch (err: any) {
      if (err?.name !== 'AbortError') toast.error('خطا در اشتراک‌گذاری تصویر');
      if (!shareImageData) setShareNote(null);
    } finally {
      setLoading(false);
    }
  };

  const handleShareText = async (note: Note) => {
    setShareMenuNoteId(null);
    const text = `${note.title}\n\n${note.content}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: note.title, text });
        toast.success('یادداشت با موفقیت به اشتراک گذاشته شد');
      } else {
        await navigator.clipboard.writeText(text);
        toast.success('متن یادداشت در کلیپ‌بورد کپی شد');
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      try {
        await navigator.clipboard.writeText(text);
        toast.success('متن یادداشت در کلیپ‌بورد کپی شد');
      } catch { toast.error('خطا در اشتراک‌گذاری متن'); }
    }
  };

  const setupSpeechRecognition = (isForm: boolean = false) => {
    if ('webkitSpeechRecognition' in window) {
      const recognition = new window.webkitSpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'fa-IR';

      if (isMobile) {
        recognition.continuous = false;
      }

      recognition.onstart = () => {
        if (isForm) {
          setIsFormRecording(true);
          formLastResultRef.current = '';
          formFinalTranscriptRef.current = '';
          setFormVoiceTranscript('');
        } else {
          setIsRecording(true);
          lastResultRef.current = '';
          finalTranscriptRef.current = '';
          setVoiceTranscript('');
        }
      };

      recognition.onresult = (event: any) => {
        let interimTranscript = '';
        let finalTranscript = isForm ? formFinalTranscriptRef.current : finalTranscriptRef.current;
        const lastResult = isForm ? formLastResultRef : lastResultRef;

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            if (transcript !== lastResult.current) {
              finalTranscript += (finalTranscript ? ' ' : '') + transcript;
              lastResult.current = transcript;
            }
          } else {
            interimTranscript += transcript;
          }
        }

        if (isForm) {
          formFinalTranscriptRef.current = finalTranscript;
          const fullTranscript = (finalTranscript + ' ' + interimTranscript).trim();
          setFormVoiceTranscript(fullTranscript);
          setNewNote(prev => ({ ...prev, content: fullTranscript }));
        } else {
          finalTranscriptRef.current = finalTranscript;
          setVoiceTranscript((finalTranscript + ' ' + interimTranscript).trim());
        }
      };

      recognition.onerror = (event: any) => {
        console.error('Speech recognition error:', event.error);
        if (event.error === 'not-allowed') {
          toast.error('لطفاً دسترسی میکروفون را فعال کنید');
        } else if (event.error === 'network') {
          toast.error('خطا در اتصال به شبکه');
        } else {
          toast.error('خطا در تشخیص گفتار');
        }
        
        if (isForm) {
          setIsFormRecording(false);
        } else {
          setIsRecording(false);
        }
      };

      recognition.onend = () => {
        if (isForm) {
          setIsFormRecording(false);
          if (isMobile && formFinalTranscriptRef.current) {
            setNewNote(prev => ({ ...prev, content: formFinalTranscriptRef.current }));
          }
        } else {
          setIsRecording(false);
          if (isMobile && finalTranscriptRef.current && userId) {
            saveVoiceNote();
          }
        }
      };

      if (isForm) {
        formRecognitionRef.current = recognition;
      } else {
        recognitionRef.current = recognition;
      }
    } else {
      // Browser support is checked at call site
    }
  };

  useEffect(() => {
    const supported = 'webkitSpeechRecognition' in window;
    if (!supported) {
      toast.error('مرورگر شما از تبدیل گفتار به متن پشتیبانی نمی‌کند');
      return;
    }
    setupSpeechRecognition();
    setupSpeechRecognition(true);
  }, []);

  const fetchNotes = async () => {
    try {
      const { data, error } = await supabase
        .from('notes')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setNotes(data || []);
    } catch (error: any) {
      toast.error('خطا در دریافت یادداشت‌ها');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNotes();

    const channel = supabase
      .channel(`notes-realtime-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notes' }, () => fetchNotes())
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  const toggleRecording = async (isForm: boolean = false) => {
    if (!hasRecordingPermission) {
      const granted = await requestRecordingPermission();
      if (!granted) return;
    }

    if (isForm ? isFormRecording : isRecording) {
      if (isForm && formRecognitionRef.current) {
        formRecognitionRef.current.stop();
      } else if (!isForm && recognitionRef.current) {
        recognitionRef.current.stop();
      }
      if (!isForm && voiceTranscript.trim() && userId) {
        saveVoiceNote();
      }
    } else {
      if (isForm) {
        formLastResultRef.current = '';
        formFinalTranscriptRef.current = '';
        setFormVoiceTranscript('');
        if (formRecognitionRef.current) {
          try {
            await formRecognitionRef.current.start();
          } catch (error) {
            console.error('Error starting form recognition:', error);
            toast.error('خطا در شروع ضبط صدا');
          }
        }
      } else {
        lastResultRef.current = '';
        finalTranscriptRef.current = '';
        setVoiceTranscript('');
        if (recognitionRef.current) {
          try {
            await recognitionRef.current.start();
          } catch (error) {
            console.error('Error starting recognition:', error);
            toast.error('خطا در شروع ضبط صدا');
          }
        }
      }
    }
  };

  const saveVoiceNote = async () => {
    try {
      const { data, error } = await supabase
        .from('notes')
        .insert([{
          title: voiceTranscript.split(' ').slice(0, 3).join(' ') + '...',
          content: voiceTranscript,
          note_type: 'voice',
          user_id: userId,
          status: 'active'
        }])
        .select()
        .single();

      if (error) throw error;

      setNotes(prev => [data, ...prev]);
      setVoiceTranscript('');
      toast.success('یادداشت صوتی با موفقیت ذخیره شد');
    } catch (error: any) {
      console.error('Error saving voice note:', error);
      toast.error('خطا در ذخیره یادداشت صوتی');
    }
  };

  const handleCreateNote = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!userId) {
      toast.error('لطفا ابتدا وارد حساب کاربری خود شوید');
      return;
    }

    try {
      const { data, error } = await supabase
        .from('notes')
        .insert([{
          title: newNote.title,
          content: newNote.content,
          note_type: 'text',
          user_id: userId,
          status: 'active'
        }])
        .select()
        .single();

      if (error) throw error;

      setNotes(prev => [data, ...prev]);
      setNewNote({ title: '', content: '' });
      setShowCreateForm(false);
      toast.success('یادداشت با موفقیت ایجاد شد');
    } catch (error: any) {
      console.error('Error creating note:', error);
      toast.error('خطا در ایجاد یادداشت');
    }
  };

  const handleEditNote = (note: Note) => {
    setEditingNoteId(note.id);
    setEditingNote(note);
  };

  const handleSaveEdit = async () => {
    if (!editingNote) return;

    try {
      const { error } = await supabase
        .from('notes')
        .update({
          title: editingNote.title,
          content: editingNote.content
        })
        .eq('id', editingNote.id);

      if (error) throw error;

      toast.success('یادداشت با موفقیت به‌روزرسانی شد');
      setEditingNoteId(null);
      setEditingNote(null);
      fetchNotes();
    } catch (error) {
      console.error('Error updating note:', error);
      toast.error('خطا در به‌روزرسانی یادداشت');
    }
  };

  const handleArchiveNote = async (noteId: string) => {
    try {
      const { error } = await supabase
        .from('notes')
        .update({ status: 'archived' })
        .eq('id', noteId);

      if (error) throw error;

      toast.success('یادداشت با موفقیت بایگانی شد');
      fetchNotes();
    } catch (error) {
      console.error('Error archiving note:', error);
      toast.error('خطا در بایگانی یادداشت');
    }
  };

  const handleDeleteNote = async (noteId: string) => {
    try {
      const { error } = await supabase.from('notes').delete().eq('id', noteId);
      if (error) throw error;
      setDeleteConfirmId(null);
      toast.success('یادداشت حذف شد');
      fetchNotes();
    } catch (error) {
      console.error('Error deleting note:', error);
      toast.error('خطا در حذف یادداشت');
    }
  };

  const handleSendToUser = async (note: Note, toUserId: string, toName: string) => {
    // Share note content by creating a notification or chat message
    // For now: copy note content to clipboard and show a message
    try {
      const text = `📝 ${note.title}\n\n${note.content}`;
      await navigator.clipboard.writeText(text);
      setAssignNote(null);
      toast.success(`یادداشت برای ${toName} کپی شد`);
    } catch {
      toast.error('خطا در ارجاع یادداشت');
    }
  };

  const filteredNotes = notes.filter(note =>
    (note.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
     note.content.toLowerCase().includes(searchTerm.toLowerCase())) &&
    (statusFilter === 'all' || note.status === statusFilter)
  );

  if (!userId) {
    return <div className="flex items-center justify-center h-96"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" /></div>;
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col" dir="rtl">
      {/* Hidden branded card for image capture */}
      {shareNote && (
        <div style={{ position: 'fixed', top: '-9999px', left: '-9999px', zIndex: -1 }}>
          <div
            ref={brandedCardRef}
            style={{
              width: '480px',
              background: 'linear-gradient(135deg, #0f2845 0%, #1e3a5f 50%, #0f2845 100%)',
              padding: '0',
              fontFamily: 'Vazir, Tahoma, Arial, sans-serif',
              direction: 'rtl',
              borderRadius: '16px',
              overflow: 'hidden',
            }}
          >
            {/* Header bar */}
            <div style={{ background: 'rgba(255,255,255,0.08)', padding: '16px 20px', display: 'flex', alignItems: 'center', gap: '12px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
              <img src="/logo_spark.png" alt="Spark" style={{ width: '36px', height: '36px', objectFit: 'contain' }} />
              <div>
                <div style={{ color: '#ffffff', fontSize: '14px', fontWeight: 'bold', lineHeight: '1.3' }}>اسپارک</div>
                <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: '11px', lineHeight: '1.3' }}>سامانه هوشمند مدیریت سازمانی</div>
              </div>
            </div>
            {/* Content area */}
            <div style={{ padding: '20px' }}>
              {/* Title */}
              <div style={{ background: 'rgba(255,255,255,0.1)', borderRadius: '10px', padding: '12px 16px', marginBottom: '12px', borderRight: '4px solid #60a5fa' }}>
                <div style={{ color: '#93c5fd', fontSize: '11px', marginBottom: '4px' }}>عنوان یادداشت</div>
                <div style={{ color: '#ffffff', fontSize: '16px', fontWeight: 'bold', lineHeight: '1.6' }}>{shareNote.title}</div>
              </div>
              {/* Content */}
              <div style={{ background: 'rgba(255,255,255,0.07)', borderRadius: '10px', padding: '14px 16px', minHeight: '80px' }}>
                <div style={{ color: '#e2e8f0', fontSize: '13px', lineHeight: '1.9', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{shareNote.content}</div>
              </div>
              {/* Date */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '14px' }}>
                <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: '10px' }}>
                  {new Date(shareNote.created_at).toLocaleDateString('fa-IR')}
                </div>
                <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: '10px' }}>spark.app</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Share Image Modal — shown when native share is unavailable */}
      {shareNote && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" dir="rtl" onClick={() => { setShareNote(null); setShareImageData(null); }}>
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center">
                  <Image className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                </div>
                <h3 className="font-bold text-gray-900 dark:text-white">اشتراک‌گذاری تصویر</h3>
              </div>
              <button onClick={() => { setShareNote(null); setShareImageData(null); }}
                className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4">
              {shareImageData ? (
                <div className="rounded-xl overflow-hidden shadow-lg mb-4">
                  <img src={shareImageData} alt="تصویر یادداشت" className="w-full" />
                </div>
              ) : (
                <div className="flex items-center justify-center h-32 bg-gray-100 dark:bg-gray-700 rounded-xl mb-4">
                  <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
                </div>
              )}
              <button
                disabled={!shareImageData}
                onClick={() => {
                  if (!shareImageData) return;
                  const link = document.createElement('a');
                  link.href = shareImageData;
                  link.download = `note-${shareNote.id}.png`;
                  document.body.appendChild(link);
                  link.click();
                  document.body.removeChild(link);
                  toast.success('تصویر با موفقیت دانلود شد');
                }}
                className="w-full flex items-center justify-center gap-2 py-2.5 bg-blue-500 hover:bg-blue-600 disabled:opacity-50 text-white text-sm font-medium rounded-xl transition-colors"
              >
                <Download className="w-4 h-4" />
                دانلود تصویر
              </button>
            </div>
          </div>
        </div>
      )}
      {isRecording && (
        <div className="fixed inset-x-0 top-20 mx-auto max-w-lg bg-white dark:bg-gray-800 p-4 rounded-lg shadow-lg z-50">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <p className="text-gray-600 dark:text-gray-300 mb-2">در حال ضبط...</p>
              <p className="text-gray-800 dark:text-white">{voiceTranscript}</p>
            </div>
            <button
              onClick={() => toggleRecording()}
              className="mr-4 p-2 bg-red-500 text-white rounded-full animate-pulse"
            >
              <Mic className="w-6 h-6" />
            </button>
          </div>
        </div>
      )}

      <div className="max-w-7xl mx-auto px-4 py-4 w-full">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold dark:text-white">یادداشت‌ها</h2>
          {canCreate && (
            <button
              onClick={() => setShowCreateForm(!showCreateForm)}
              className="flex items-center gap-2 bg-blue-500 text-white px-4 py-2 rounded-lg hover:bg-blue-600 transition-colors"
            >
              <Plus className="w-5 h-5" />
              یادداشت جدید
            </button>
          )}
        </div>

        {showCreateForm && (
          <form onSubmit={handleCreateNote} className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 mb-6">
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  عنوان
                </label>
                <input
                  type="text"
                  value={newNote.title}
                  onChange={(e) => setNewNote({ ...newNote, title: e.target.value })}
                  className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white"
                  required
                />
              </div>
              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                    متن یادداشت
                  </label>
                  <button
                    type="button"
                    onClick={() => toggleRecording(true)}
                    className={`p-2 rounded-full ${
                      isFormRecording ? 'bg-red-500 animate-pulse' : 'bg-blue-500 hover:bg-blue-600'
                    } text-white transition-colors`}
                    title={isFormRecording ? 'توقف ضبط' : 'شروع ضبط صدا'}
                  >
                    <Mic className="w-5 h-5" />
                  </button>
                </div>
                <textarea
                  value={newNote.content}
                  onChange={(e) => setNewNote({ ...newNote, content: e.target.value })}
                  rows={4}
                  className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white"
                  required
                ></textarea>
              </div>
              <button
                type="submit"
                className="w-full flex items-center justify-center gap-2 bg-blue-500 text-white py-2 rounded-lg hover:bg-blue-600"
              >
                <Save className="w-5 h-5" />
                ذخیره یادداشت
              </button>
            </div>
          </form>
        )}

        <div className="flex flex-col md:flex-row gap-4 mb-6">
          <div className="relative flex-1">
            <Search className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 dark:text-gray-500" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="جستجو در یادداشت‌ها..."
              className="w-full pl-4 pr-10 py-2 rounded-lg border border-gray-300 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'all' | 'active' | 'archived')}
            className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
          >
            <option value="all">همه یادداشت‌ها</option>
            <option value="active">یادداشت‌های فعال</option>
            <option value="archived">یادداشت‌های بایگانی شده</option>
          </select>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filteredNotes.map((note, index) => {
            const colors = NOTE_COLORS[index % NOTE_COLORS.length];
            const isExpanded = expandedNoteId === note.id;
            return (
            <div
              key={note.id}
              id={`note-${note.id}`}
              className={`rounded-2xl border shadow-sm hover:shadow-md transition-all duration-200 overflow-hidden flex flex-col ${colors.bg} ${colors.border} ${
                note.status === 'archived' ? 'opacity-60' : ''
              } ${editingNoteId === note.id || isExpanded ? '' : 'h-52'}`}
            >
              {editingNoteId === note.id ? (
                <div className="p-4 space-y-3">
                  <input
                    type="text"
                    value={editingNote?.title || ''}
                    onChange={(e) => setEditingNote(prev => prev ? {...prev, title: e.target.value} : null)}
                    className="w-full p-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 dark:text-white"
                  />
                  <textarea
                    value={editingNote?.content || ''}
                    onChange={(e) => setEditingNote(prev => prev ? {...prev, content: e.target.value} : null)}
                    rows={3}
                    className="w-full p-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 dark:text-white resize-none"
                  />
                  <div className="flex gap-2">
                    <button onClick={handleSaveEdit} className="flex-1 flex items-center justify-center gap-1.5 bg-green-500 text-white py-2 text-sm rounded-lg hover:bg-green-600">
                      <Save className="w-3.5 h-3.5" /> ذخیره
                    </button>
                    <button onClick={() => { setEditingNoteId(null); setEditingNote(null); }} className="flex-1 flex items-center justify-center gap-1.5 bg-gray-400 text-white py-2 text-sm rounded-lg hover:bg-gray-500">
                      <X className="w-3.5 h-3.5" /> انصراف
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {/* Card header */}
                  <div className={`flex items-start justify-between px-4 pt-3 pb-2 flex-shrink-0 ${colors.header}`}>
                    <h3 className="text-sm font-semibold text-gray-800 dark:text-white leading-tight flex-1 min-w-0 truncate ml-2">{note.title}</h3>
                    <div className="flex items-center gap-0.5 flex-shrink-0">
                      {note.note_type === 'voice' && <Mic className="w-3.5 h-3.5 text-gray-400 ml-1" />}
                      <div className="relative" ref={shareMenuNoteId === note.id ? shareMenuRef : undefined}>
                        <button
                          onClick={() => setShareMenuNoteId(v => v === note.id ? null : note.id)}
                          className="p-1 rounded-lg text-gray-400 hover:text-blue-500 transition-colors"
                          title="اشتراک‌گذاری"
                        >
                          <Share2 className="w-3.5 h-3.5" />
                        </button>
                        {shareMenuNoteId === note.id && (
                          <div className="absolute left-0 top-full mt-1 w-40 bg-white dark:bg-gray-800 rounded-2xl shadow-xl border border-gray-100 dark:border-gray-700 z-50 overflow-hidden" dir="rtl">
                            <button
                              onClick={() => handleShareImage(note)}
                              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-right"
                            >
                              <div className="w-7 h-7 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
                                <Image className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                              </div>
                              <span className="text-sm text-gray-700 dark:text-gray-200">اشتراک تصویر</span>
                            </button>
                            <div className="h-px bg-gray-100 dark:bg-gray-700 mx-3" />
                            <button
                              onClick={() => handleShareText(note)}
                              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-right"
                            >
                              <div className="w-7 h-7 rounded-xl bg-teal-100 dark:bg-teal-900/30 flex items-center justify-center flex-shrink-0">
                                <FileText className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
                              </div>
                              <span className="text-sm text-gray-700 dark:text-gray-200">اشتراک متن</span>
                            </button>
                          </div>
                        )}
                      </div>
                      <button onClick={() => { setAssignNote(note); setAssignSearch(''); }} className="p-1 rounded-lg text-gray-400 hover:text-teal-500 transition-colors" title="ارجاع">
                        <Send className="w-3.5 h-3.5" />
                      </button>
                      {canEdit && (
                        <button onClick={() => handleEditNote(note)} className="p-1 rounded-lg text-gray-400 hover:text-blue-500 transition-colors">
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {canDelete && (
                        <button onClick={() => handleArchiveNote(note.id)} className="p-1 rounded-lg text-gray-400 hover:text-amber-500 transition-colors" title="بایگانی">
                          <Archive className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {canDelete && (
                        <button onClick={() => setDeleteConfirmId(note.id)} className="p-1 rounded-lg text-gray-400 hover:text-red-500 transition-colors" title="حذف">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Card body — fixed height, scrollable when expanded */}
                  <div className="px-4 pb-3 flex flex-col flex-1 min-h-0">
                    <div
                      className={`flex-1 overflow-hidden cursor-pointer transition-all duration-300 ${isExpanded ? 'overflow-y-auto' : ''}`}
                      onClick={() => setExpandedNoteId(isExpanded ? null : note.id)}
                      title={isExpanded ? 'کلیک برای جمع‌کردن' : 'کلیک برای مشاهده کامل'}
                    >
                      <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed whitespace-pre-wrap">{note.content}</p>
                    </div>

                    {note.file_url && (
                      <div
                        onClick={() => handleFileClick(note)}
                        className="mt-2 p-2.5 bg-white/60 dark:bg-gray-800/40 rounded-xl cursor-pointer hover:bg-white/90 dark:hover:bg-gray-700/60 transition-colors flex items-center gap-2 border border-white/80 dark:border-gray-600/30 flex-shrink-0"
                      >
                        <span className="text-gray-500 dark:text-gray-400">{getFileIcon(note.file_type || '')}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate">{note.file_name}</p>
                          {note.file_size && <p className="text-[10px] text-gray-400">{formatFileSize(note.file_size)}</p>}
                        </div>
                        <Download className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                      </div>
                    )}

                    <div className="flex items-center justify-between mt-2 flex-shrink-0">
                      <p className="text-[10px] text-gray-400 dark:text-gray-500">
                        {new Date(note.created_at).toLocaleString('fa-IR')}
                      </p>
                      <div className="flex items-center gap-2">
                        {note.content.length > 80 && (
                          <button
                            onClick={() => setExpandedNoteId(isExpanded ? null : note.id)}
                            className="text-[11px] text-blue-500 hover:underline"
                          >
                            {isExpanded ? 'بستن' : 'بیشتر...'}
                          </button>
                        )}
                        {note.status === 'archived' && (
                          <span className="text-[10px] px-2 py-0.5 bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400 rounded-full">بایگانی</span>
                        )}
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
            );
          })}
        </div>
      </div>

      <div className="fixed bottom-6 left-6">
        <button
          onClick={() => toggleRecording()}
          className={`w-14 h-14 ${
            isRecording ? 'bg-red-500' : 'bg-blue-500'
          } rounded-full flex items-center justify-center shadow-lg hover:bg-blue-600 transition-colors`}
          title="یادداشت صوتی"
        >
          <Mic className="w-6 h-6 text-white" />
        </button>
      </div>

      {/* Delete confirm modal */}
      {deleteConfirmId && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/50 backdrop-blur-[2px]" dir="rtl">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-xs overflow-hidden">
            <div className="bg-red-500 px-5 py-4">
              <h3 className="text-white font-bold text-sm">حذف یادداشت</h3>
              <p className="text-red-100 text-xs mt-1">این یادداشت برای همیشه حذف خواهد شد</p>
            </div>
            <div className="p-5 space-y-3">
              <button
                onClick={() => handleDeleteNote(deleteConfirmId)}
                className="w-full flex items-center justify-center gap-2 py-2.5 bg-red-500 hover:bg-red-600 text-white text-sm font-medium rounded-xl transition-colors"
              >
                <Trash2 className="w-4 h-4" /> حذف کامل
              </button>
              <button
                onClick={() => setDeleteConfirmId(null)}
                className="w-full py-2.5 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
              >
                انصراف
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Assign note modal */}
      {assignNote && (
        <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-[2px]" dir="rtl" onClick={() => setAssignNote(null)}>
          <div className="w-full sm:w-96 bg-white dark:bg-gray-900 rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800">
              <h3 className="font-bold text-gray-900 dark:text-white text-sm">ارجاع یادداشت</h3>
              <button onClick={() => setAssignNote(null)} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-4 py-2.5 border-b border-gray-50 dark:border-gray-800">
              <p className="text-xs text-gray-500 dark:text-gray-400 truncate">«{assignNote.title}»</p>
            </div>
            <div className="px-3 py-2">
              <div className="relative">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
                <input
                  value={assignSearch}
                  onChange={e => setAssignSearch(e.target.value)}
                  placeholder="جستجوی کاربر..."
                  autoFocus
                  className="w-full pr-9 pl-3 py-2 text-sm bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl outline-none focus:ring-2 focus:ring-teal-400 dark:text-white"
                />
              </div>
            </div>
            <div className="overflow-y-auto max-h-60 pb-2">
              {orgUsers
                .filter(u => u.user_id !== userId && (
                  (u.full_name || '').toLowerCase().includes(assignSearch.toLowerCase()) ||
                  (u.email || '').toLowerCase().includes(assignSearch.toLowerCase())
                ))
                .map(u => (
                  <button
                    key={u.user_id}
                    onClick={() => handleSendToUser(assignNote, u.user_id, u.full_name || u.email || 'کاربر')}
                    className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-right"
                  >
                    <div className="w-8 h-8 rounded-full bg-teal-500 flex items-center justify-center flex-shrink-0 text-white text-xs font-bold">
                      {(u.full_name || u.email || 'U').charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{u.full_name || u.email}</p>
                      {u.full_name && <p className="text-[11px] text-gray-400 truncate">{u.email}</p>}
                    </div>
                    <Send className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                  </button>
                ))}
              {orgUsers.filter(u => u.user_id !== userId && (
                (u.full_name || '').toLowerCase().includes(assignSearch.toLowerCase()) ||
                (u.email || '').toLowerCase().includes(assignSearch.toLowerCase())
              )).length === 0 && (
                <p className="text-center text-sm text-gray-400 dark:text-gray-500 py-6">کاربری یافت نشد</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}