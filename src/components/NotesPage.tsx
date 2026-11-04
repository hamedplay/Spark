import { useLiveData, LIVE_DATA } from '../shared/realtime/useLiveData';
import { lazy, Suspense, useState, useEffect, useRef } from 'react';
import '../notes-theme.css';
import { Plus, Mic } from 'lucide-react';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';
import { usePermissions } from '../context/PermissionsContext';
import { useOrgUsers } from '../lib/useOrgUsers';
import { insertNotification } from '../lib/notifications';

import { NOTE_COLORS } from './Notes/constants';
import type { Note } from './Notes/types';
import { getFileIcon, formatFileSize } from './Notes/utils';
import { BrandedShareCard } from './Notes/BrandedShareCard';
import { RecordingIndicator } from './Notes/RecordingIndicator';
import { NotesToolbar } from './Notes/NotesToolbar';
import { NoteCard } from './Notes/NoteCard';
import { validateNoteReminder } from './Notes/reminderTime';

const ShareImageModal = lazy(() => import('./Notes/ShareImageModal').then((m) => ({ default: m.ShareImageModal })));
const CreateNoteForm = lazy(() => import('./Notes/CreateNoteForm').then((m) => ({ default: m.CreateNoteForm })));
const DeleteConfirmModal = lazy(() => import('./Notes/DeleteConfirmModal').then((m) => ({ default: m.DeleteConfirmModal })));
const AssignNoteModal = lazy(() => import('./Notes/AssignNoteModal').then((m) => ({ default: m.AssignNoteModal })));


export function NotesPage({ currentUserId: propUserId }: { currentUserId?: string | null }) {
  useLiveData(LIVE_DATA.notes, async () => { await fetchNotes(); });
  const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isMobile = isIOS || window.innerWidth < 768;
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('notes_create');
  const canEdit = hasPermission('notes_edit');
  const canDelete = hasPermission('notes_delete');
  const [notes, setNotes] = useState<Note[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [newReminderUsers, setNewReminderUsers] = useState<string[]>([]);
  const [newReminderAt, setNewReminderAt] = useState<string | null>(null);
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
  const { allUsers: orgUsers, loading: reminderUsersLoading, error: reminderUsersError } = useOrgUsers(userId, assignNote !== null || showCreateForm || editingNoteId !== null);
  const reminderUsers = orgUsers.filter(user => user.user_id !== userId);
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

      const imgs = brandedCardRef.current.querySelectorAll('img');
      await Promise.all(Array.from(imgs).map(img =>
        img.complete ? Promise.resolve() : new Promise<void>((r) => { img.onload = () => r(); img.onerror = () => r(); })
      ));

      const { toPng } = await import('html-to-image');

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

      setShareImageData(imageData);
    } catch {
      toast.error('خطا در ایجاد تصویر یادداشت');
      setShareNote(null);
      setShareImageData(null);
    }
  };

  const handleShareText = async (note: Note) => {
    setShareMenuNoteId(null);
    const text = `${note.title}\n\n${note.content}`;
    try {
      await navigator.clipboard.writeText(text);
      toast.success('متن یادداشت در کلیپ‌بورد کپی شد');
    } catch {
      toast.error('خطا در کپی متن یادداشت');
    }
  };

  const getSpeechRecognitionAPI = (): any =>
    (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null;

  const startRecognitionSession = (isForm: boolean) => {
    const SpeechRecognitionAPI = getSpeechRecognitionAPI();
    if (!SpeechRecognitionAPI) return;

    const recognition = new SpeechRecognitionAPI();
    recognition.continuous = !isMobile;
    recognition.interimResults = true;
    recognition.lang = 'fa-IR';
    let sessionEnded = false;

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
      if (isForm) setIsFormRecording(false);
      else setIsRecording(false);

      if (event.error === 'not-allowed' || event.error === 'permission-denied') {
        setHasRecordingPermission(false);
        toast.error(isIOS
          ? 'دسترسی تشخیص گفتار مجاز نیست. مجوز میکروفون Safari و فعال بودن Siri و Dictation را در تنظیمات آیفون بررسی کنید.'
          : 'لطفاً دسترسی میکروفون را فعال کنید');
      } else if (event.error === 'language-not-supported') {
        toast.error('سرویس تشخیص گفتار این دستگاه از زبان فارسی پشتیبانی نمی‌کند.');
      } else if (event.error === 'service-not-allowed') {
        toast.error('سرویس تشخیص گفتار دستگاه در دسترس نیست. در آیفون فعال بودن Siri و Dictation را بررسی کنید.');
      } else if (event.error === 'network') {
        toast.error('برای تشخیص گفتار به اتصال اینترنت نیاز است');
      } else if (event.error === 'audio-capture') {
        toast.error('میکروفون در دسترس نیست');
      } else if (event.error === 'no-speech') {
        toast.error('گفتاری دریافت نشد. دوباره تلاش کنید.');
      } else if (event.error !== 'aborted') {
        toast.error('خطا در تشخیص گفتار؛ دوباره تلاش کنید');
      }
    };

    recognition.onend = () => {
      if (sessionEnded) return;
      sessionEnded = true;
      if (isForm) {
        formRecognitionRef.current = null;
        setIsFormRecording(false);
        if (isMobile && formFinalTranscriptRef.current) {
          setNewNote(prev => ({ ...prev, content: formFinalTranscriptRef.current }));
        }
      } else {
        recognitionRef.current = null;
        setIsRecording(false);
        // Event handlers retain the render that started recognition. Read the
        // final result from the ref, not that render's stale voiceTranscript.
        const transcript = finalTranscriptRef.current.trim();
        if (transcript && userId) saveVoiceNote(transcript);
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
      if (isForm) {
        formRecognitionRef.current = null;
        setIsFormRecording(false);
      } else {
        recognitionRef.current = null;
        setIsRecording(false);
      }
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

    const recognition = isForm ? formRecognitionRef.current : recognitionRef.current;
    if (recognition) {
      try { recognition.stop(); } catch {}
      return;
    }
    // Let WebKit request speech permission directly within the click handler,
    // without opening and stopping a separate audio capture session first.
    // Retain the existing microphone preflight for other devices.
    if (!isIOS && !hasRecordingPermission) {
      const granted = await requestRecordingPermission();
      if (!granted) return;
    }
    startRecognitionSession(isForm);
  };

  const saveVoiceNote = async (transcript: string) => {
    const content = transcript.trim();
    if (!content || !userId) return;
    try {
      const { data, error } = await supabase
        .from('notes')
        .insert([{
          title: content.split(' ').slice(0, 3).join(' ') + '...',
          content,
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
      validateNoteReminder(newReminderAt);
      const { data, error } = await supabase
        .from('notes')
        .insert([{
          title: newNote.title,
          content: newNote.content,
          note_type: 'text',
          remind_at: newReminderAt,
          reminder_user_ids: newReminderAt ? newReminderUsers : [],
          user_id: userId,
          status: 'active'
        }])
        .select()
        .single();

      if (error) throw error;

      setNotes(prev => [data, ...prev]);
      setNewNote({ title: '', content: '' });
      setNewReminderAt(null);
      setNewReminderUsers([]);
      setShowCreateForm(false);
      toast.success('یادداشت با موفقیت ایجاد شد');
    } catch (error: any) {
      console.error('Error creating note:', error);
      toast.error(error?.message || 'خطا در ایجاد یادداشت');
    }
  };

  const handleEditNote = (note: Note) => {
    setEditingNoteId(note.id);
    setEditingNote(note);
  };

  const handleSaveEdit = async () => {
    if (!editingNote) return;

    try {
      const original = notes.find(note => note.id === editingNote.id);
      validateNoteReminder(editingNote.remind_at ?? null, original?.remind_at ?? null);
      const { error } = await supabase
        .from('notes')
        .update({
          title: editingNote.title,
          content: editingNote.content,
          remind_at: editingNote.remind_at ?? null,
          reminder_user_ids: editingNote.remind_at ? editingNote.reminder_user_ids ?? [] : []
        })
        .eq('id', editingNote.id);

      if (error) throw error;

      toast.success('یادداشت با موفقیت به‌روزرسانی شد');
      setEditingNoteId(null);
      setEditingNote(null);
      fetchNotes();
    } catch (error: any) {
      console.error('Error updating note:', error);
      toast.error(error?.message || 'خطا در به‌روزرسانی یادداشت');
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
    return <div className="flex items-center justify-center h-96"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-violet-500" /></div>;
  }

  return (
    <div className="min-h-full bg-slate-50/80 dark:bg-slate-950 flex flex-col" dir="rtl">
      <BrandedShareCard shareNote={shareNote} brandedCardRef={brandedCardRef} />

      {(shareNote || shareImageData) && (
        <Suspense fallback={null}>
          <ShareImageModal
            shareNote={shareNote}
            shareImageData={shareImageData}
            onClose={() => { setShareNote(null); setShareImageData(null); }}
          />
        </Suspense>
      )}
      {isRecording && (
        <RecordingIndicator voiceTranscript={voiceTranscript} onStop={() => toggleRecording()} />
      )}

      <div className="max-w-7xl mx-auto px-3 py-3 sm:px-4 sm:py-4 w-full">
        <div className="mb-4 flex items-center justify-between gap-3 sm:mb-5">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white sm:text-2xl">یادداشت‌ها</h2>
            <p className="mt-0.5 hidden text-[11px] text-slate-400 sm:block">ثبت، جستجو و مدیریت یادداشت‌های شخصی و صوتی</p>
          </div>

          <div className="flex flex-shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => toggleRecording()}
              className={`flex h-9 w-9 items-center justify-center rounded-xl text-white shadow-sm transition sm:hidden ${
                isRecording ? 'bg-rose-500 hover:bg-rose-600' : 'bg-violet-600 hover:bg-violet-700'
              }`}
              title={isRecording ? 'توقف یادداشت صوتی' : 'یادداشت صوتی'}
              aria-label={isRecording ? 'توقف یادداشت صوتی' : 'یادداشت صوتی'}
            >
              <Mic className="h-4 w-4" />
            </button>

            {canCreate && (
              <button
                onClick={() => setShowCreateForm(!showCreateForm)}
                className="flex h-9 items-center gap-1.5 rounded-xl bg-gradient-to-l from-violet-600 to-indigo-600 px-3 text-xs font-bold text-white shadow-sm transition hover:from-violet-500 hover:to-indigo-500 sm:gap-2 sm:px-4 sm:text-sm"
              >
                <Plus className="h-4 w-4 sm:h-5 sm:w-5" />
                <span className="hidden min-[360px]:inline">یادداشت جدید</span>
                <span className="min-[360px]:hidden">جدید</span>
              </button>
            )}
          </div>
        </div>

        {showCreateForm && (
          <Suspense fallback={null}>
            <CreateNoteForm
            newNote={newNote}
            setNewNote={setNewNote}
            onSubmit={handleCreateNote}
            reminderAt={newReminderAt}
            onReminderChange={value => { setNewReminderAt(value); if (!value) setNewReminderUsers([]); }}
            reminderUserIds={newReminderUsers}
            onReminderUsersChange={setNewReminderUsers}
            reminderUsers={reminderUsers}
            usersLoading={reminderUsersLoading}
            usersError={reminderUsersError}
            isFormRecording={isFormRecording}
            onToggleRecording={() => toggleRecording(true)}
            />
          </Suspense>
        )}

        <NotesToolbar
          searchTerm={searchTerm}
          setSearchTerm={setSearchTerm}
          statusFilter={statusFilter}
          setStatusFilter={setStatusFilter}
        />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
          {filteredNotes.map((note, index) => {
            const colors = NOTE_COLORS[index % NOTE_COLORS.length];
            const isExpanded = expandedNoteId === note.id;
            return (
              <NoteCard
                key={note.id}
                note={note}
                reminderUsers={reminderUsers}
                usersLoading={reminderUsersLoading}
                usersError={reminderUsersError}
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

      <div className="fixed bottom-6 left-6 z-30 hidden sm:block">
        <button
          onClick={() => toggleRecording()}
          className={`flex h-12 w-12 items-center justify-center rounded-full text-white shadow-lg transition ${
            isRecording ? 'bg-rose-500 hover:bg-rose-600' : 'bg-violet-600 hover:bg-violet-700'
          }`}
          title="یادداشت صوتی"
          aria-label="یادداشت صوتی"
        >
          <Mic className="h-5 w-5" />
        </button>
      </div>

      {deleteConfirmId && (
        <Suspense fallback={null}>
          <DeleteConfirmModal
            deleteConfirmId={deleteConfirmId}
            onConfirm={handleDeleteNote}
            onCancel={() => setDeleteConfirmId(null)}
          />
        </Suspense>
      )}

      {assignNote && (
        <Suspense fallback={null}>
          <AssignNoteModal
            assignNote={assignNote}
            assignSearch={assignSearch}
            setAssignSearch={setAssignSearch}
            orgUsers={orgUsers}
            userId={userId}
            onClose={() => setAssignNote(null)}
            onSend={handleSendToUser}
          />
        </Suspense>
      )}
    </div>
  );
}
