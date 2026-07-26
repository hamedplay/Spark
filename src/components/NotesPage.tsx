import { useState, useEffect, useRef } from 'react';
import { Plus, Mic } from 'lucide-react';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';
import { usePermissions } from '../context/PermissionsContext';
import { toPng } from 'html-to-image';
import { useOrgUsers } from '../lib/useOrgUsers';
import { insertNotification } from '../lib/notifications';

import { NOTE_COLORS } from './Notes/constants';
import type { Note } from './Notes/types';
import { getFileIcon, formatFileSize } from './Notes/utils';
import { BrandedShareCard } from './Notes/BrandedShareCard';
import { ShareImageModal } from './Notes/ShareImageModal';
import { RecordingIndicator } from './Notes/RecordingIndicator';
import { CreateNoteForm } from './Notes/CreateNoteForm';
import { NotesToolbar } from './Notes/NotesToolbar';
import { DeleteConfirmModal } from './Notes/DeleteConfirmModal';
import { AssignNoteModal } from './Notes/AssignNoteModal';
import { NoteCard } from './Notes/NoteCard';

export function NotesPage({ currentUserId: propUserId }: { currentUserId?: string | null }) {
  const isMobile = window.innerWidth < 768;
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
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingNote, setEditingNote] = useState<Note | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'archived'>('active');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [hasRecordingPermission, setHasRecordingPermission] = useState<boolean | null>(null);
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

  const getFileIconFn = getFileIcon;
  const formatFileSizeFn = formatFileSize;

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
    setShareNote(note);
    setShareImageData(null);

    try {
      // Poll for the ref — DOM commit + image load can take >80ms on slow networks
      let elapsed = 0;
      while (!brandedCardRef.current && elapsed < 2000) {
        await new Promise(r => setTimeout(r, 60));
        elapsed += 60;
      }
      if (!brandedCardRef.current) {
        toast.error('خطا در ایجاد تصویر یادداشت');
        setShareNote(null);
        return;
      }

      // Wait for any images inside the card to finish loading
      const imgs = brandedCardRef.current.querySelectorAll('img');
      await Promise.all(Array.from(imgs).map(img =>
        img.complete ? Promise.resolve() : new Promise<void>((r) => { img.onload = () => r(); img.onerror = () => r(); })
      ));

      // Retry toPng up to 3 times — it can fail on first attempt on slow/busy devices
      let imageData: string | null = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          imageData = await toPng(brandedCardRef.current, { quality: 1, pixelRatio: 2, backgroundColor: '#ffffff' });
          break;
        } catch {
          if (attempt === 3) throw new Error('toPng failed after 3 attempts');
          await new Promise(r => setTimeout(r, 150 * attempt));
        }
      }
      if (!imageData) throw new Error('no image data');

      // Try native share (files); fall through to download modal if not supported
      let canShareFiles = false;
      try {
        canShareFiles = !!(navigator.share && navigator.canShare?.({ files: [new File([], 'note.png', { type: 'image/png' })] }));
      } catch { /* canShare not supported */ }

      if (canShareFiles) {
        const blob = await (await fetch(imageData)).blob();
        const file = new File([blob], 'note.png', { type: 'image/png' });
        // Preload image using promise to ensure it's ready before sharing
        const img = new window.Image();
        img.src = URL.createObjectURL(blob);
        await (img.complete ? Promise.resolve() : new Promise<void>(resolve => {
          img.onload = () => resolve();
          img.onerror = () => resolve();
        }));
        await navigator.share({ title: note.title, files: [file] });
        toast.success('یادداشت با موفقیت به اشتراک گذاشته شد');
        setShareNote(null);
      } else {
        setShareImageData(imageData);
      }
    } catch (err: any) {
      if (err?.name !== 'AbortError') toast.error('خطا در اشتراک‌گذاری تصویر');
      setShareNote(null);
      setShareImageData(null);
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
      if (err?.name !== 'AbortError') return;
      try {
        await navigator.clipboard.writeText(text);
        toast.success('متن یادداشت در کلیپ‌بورد کپی شد');
      } catch { toast.error('خطا در اشتراک‌گذاری متن'); }
    }
  };

  const getSpeechRecognitionAPI = (): any =>
    (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null;

  const startRecognitionSession = (isForm: boolean) => {
    const SpeechRecognitionAPI = getSpeechRecognitionAPI();
    if (!SpeechRecognitionAPI) return;

    // Create a fresh instance on every start — required on some Android/iOS browsers
    // where the same object cannot be reused after onend fires.
    const recognition = new SpeechRecognitionAPI();
    recognition.continuous = !isMobile;
    recognition.interimResults = true;
    recognition.lang = 'fa-IR';

    recognition.onstart = () => {
      if (isForm) {
        setIsFormRecording(true);
        formLastResultRef.current = '';
        formFinalTranscriptRef.current = '';
        setVoiceTranscript('');
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
        setNewNote(prev => ({ ...prev, content: fullTranscript }));
      } else {
        finalTranscriptRef.current = finalTranscript;
        setVoiceTranscript((finalTranscript + ' ' + interimTranscript).trim());
      }
    };

    recognition.onerror = (event: any) => {
      if (event.error === 'not-allowed' || event.error === 'permission-denied') {
        toast.error('لطفاً دسترسی میکروفون را فعال کنید');
        if (isForm) setIsFormRecording(false);
        else setIsRecording(false);
      } else if (event.error === 'network') {
        toast.error('برای تشخیص گفتار به اتصال اینترنت نیاز است');
        if (isForm) setIsFormRecording(false);
        else setIsRecording(false);
      } else if (event.error === 'audio-capture') {
        toast.error('میکروفون در دسترس نیست');
        if (isForm) setIsFormRecording(false);
        else setIsRecording(false);
      }
      // no-speech / aborted / other: handled silently via onend
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

    try {
      recognition.start();
    } catch {
      if (isForm) setIsFormRecording(false);
      else setIsRecording(false);
      toast.error('خطا در شروع ضبط صدا');
    }
  };

  useEffect(() => {
    // No toast on page load — show support error only when user clicks the button
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
    if (!getSpeechRecognitionAPI()) {
      toast.error('مرورگر شما از تبدیل گفتار به متن پشتیبانی نمی‌کند.\nلطفاً از Chrome یا Safari استفاده کنید.');
      return;
    }

    if (!hasRecordingPermission) {
      const granted = await requestRecordingPermission();
      if (!granted) return;
    }

    if (isForm ? isFormRecording : isRecording) {
      // Stop current session
      if (isForm && formRecognitionRef.current) {
        try { formRecognitionRef.current.stop(); } catch {}
      } else if (!isForm && recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch {}
        if (voiceTranscript.trim() && userId) saveVoiceNote();
      }
    } else {
      // Start a fresh session
      startRecognitionSession(isForm);
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
    try {
      const { error: insertError } = await supabase.rpc('share_note_to_user', {
        p_title: note.title,
        p_content: note.content,
        p_note_type: note.note_type,
        p_recipient_id: toUserId,
        p_sender_id: userId,
      });
      if (insertError) throw insertError;

      // Send in-app notification to recipient
      const senderProfile = orgUsers.find(u => u.user_id === userId);
      const senderName = senderProfile?.full_name || senderProfile?.email || 'کاربر';
      const recipientProfile = orgUsers.find(u => u.user_id === toUserId);
      const recipientFullName = recipientProfile?.full_name || '';
      await insertNotification({
        userId: toUserId,
        category: 'note',
        eventType: 'share',
        fallbackTitle: 'یادداشت جدید دریافت شد',
        fallbackMessage: `«${senderName}» یادداشت «${note.title}» را برای شما ارسال کرد`,
        placeholders: { sender_name: senderName, note_title: note.title, full_name: recipientFullName, recipient_greeting: recipientFullName ? `${recipientFullName} گرامی` : 'همکار گرامی' },
        senderId: userId,
        senderName,
      });

      setAssignNote(null);
      toast.success(`یادداشت برای ${toName} ارسال شد`);
    } catch (err: any) {
      toast.error('خطا در ارسال یادداشت: ' + (err?.message || ''));
    }
  };

  const filteredNotes = notes.filter(note =>
    ((note.title ?? '').toLowerCase().includes(searchTerm.toLowerCase()) ||
     (note.content ?? '').toLowerCase().includes(searchTerm.toLowerCase())) &&
    (statusFilter === 'all' || note.status === statusFilter)
  );

  if (!userId) {
    return <div className="flex items-center justify-center h-96"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" /></div>;
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col" dir="rtl">
      <BrandedShareCard shareNote={shareNote} brandedCardRef={brandedCardRef} />

      <ShareImageModal
        shareNote={shareNote}
        shareImageData={shareImageData}
        onClose={() => { setShareNote(null); setShareImageData(null); }}
      />
      {isRecording && (
        <RecordingIndicator voiceTranscript={voiceTranscript} onStop={() => toggleRecording()} />
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
          <CreateNoteForm
            newNote={newNote}
            setNewNote={setNewNote}
            onSubmit={handleCreateNote}
            isFormRecording={isFormRecording}
            onToggleRecording={() => toggleRecording(true)}
          />
        )}

        <NotesToolbar
          searchTerm={searchTerm}
          setSearchTerm={setSearchTerm}
          statusFilter={statusFilter}
          setStatusFilter={setStatusFilter}
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filteredNotes.map((note, index) => {
            const colors = NOTE_COLORS[index % NOTE_COLORS.length];
            const isExpanded = expandedNoteId === note.id;
            return (
              <NoteCard
                key={note.id}
                note={note}
                colors={colors}
                isExpanded={isExpanded}
                isEditing={editingNoteId === note.id}
                editingNote={editingNote}
                shareMenuOpen={shareMenuNoteId === note.id}
                canEdit={canEdit}
                canDelete={canDelete}
                shareMenuRef={shareMenuRef}
                onSetExpandedNoteId={setExpandedNoteId}
                onSetEditingNote={setEditingNote}
                onSetEditingNoteId={setEditingNoteId}
                onHandleSaveEdit={handleSaveEdit}
                onHandleEditNote={handleEditNote}
                onHandleArchiveNote={handleArchiveNote}
                onSetDeleteConfirmId={setDeleteConfirmId}
                onSetAssignNote={setAssignNote}
                onSetAssignSearch={setAssignSearch}
                onSetShareMenuNoteId={setShareMenuNoteId}
                onHandleShareImage={handleShareImage}
                onHandleShareText={handleShareText}
                onHandleFileClick={handleFileClick}
              />
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

      <DeleteConfirmModal
        deleteConfirmId={deleteConfirmId}
        onConfirm={handleDeleteNote}
        onCancel={() => setDeleteConfirmId(null)}
      />

      <AssignNoteModal
        assignNote={assignNote}
        assignSearch={assignSearch}
        setAssignSearch={setAssignSearch}
        orgUsers={orgUsers}
        userId={userId}
        onClose={() => setAssignNote(null)}
        onSend={handleSendToUser}
      />
    </div>
  );
}
