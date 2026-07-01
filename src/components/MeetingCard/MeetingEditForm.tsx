import React, { useState, useEffect } from 'react';
import { Save, X, Loader as Loader2, Users, ClipboardList, Plus, Pencil, Trash2, Check, UserCheck, Clock } from 'lucide-react';
import { Meeting } from '../../types';
import type { AgendaItem } from '../../types';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';
import DatePicker from 'react-datepicker';
import { ContactEmail } from '../../types';

interface MeetingEditFormProps {
  meeting: Meeting;
  onSave: () => void;
  onCancel: () => void;
}

export function MeetingEditForm({ meeting, onSave, onCancel }: MeetingEditFormProps) {
  const [editedMeeting, setEditedMeeting] = useState(meeting);
  const [editParticipants, setEditParticipants] = useState(meeting.participants.join('\n'));
  const [selectedDate, setSelectedDate] = useState<Date>(new Date(meeting.requestDate));
  const [loading, setLoading] = useState(false);
  const [contacts, setContacts] = useState<ContactEmail[]>([]);
  const [selectedEmails, setSelectedEmails] = useState<string[]>(meeting.guest_emails || []);
  const [loadingContacts, setLoadingContacts] = useState(false);

  // Agenda
  const [agendaEnabled, setAgendaEnabled] = useState(false);
  const [agendaItems, setAgendaItems] = useState<Omit<AgendaItem, 'id' | 'meeting_id' | 'created_at'>[]>([]);
  const [showAgendaForm, setShowAgendaForm] = useState(false);
  const [agendaForm, setAgendaForm] = useState({ title: '', presenter: '', duration_minutes: '' });
  const [editingAgendaIdx, setEditingAgendaIdx] = useState<number | null>(null);

  useEffect(() => {
    fetchContacts();
    loadAgendaItems();
  }, []);

  const fetchContacts = async () => {
    try {
      setLoadingContacts(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data, error } = await supabase.from('contacts_email').select('*').eq('user_id', user.id).order('name');
      if (error) throw error;
      setContacts(data || []);
    } catch (error) {
      console.error('Error fetching contacts:', error);
    } finally {
      setLoadingContacts(false);
    }
  };

  const loadAgendaItems = async () => {
    const { data } = await supabase
      .from('meeting_agenda_items')
      .select('*')
      .eq('meeting_id', meeting.id)
      .order('sort_order');
    if (data && data.length > 0) {
      setAgendaEnabled(true);
      setAgendaItems(data.map((it: any) => ({
        title: it.title,
        presenter: it.presenter,
        duration_minutes: it.duration_minutes,
        sort_order: it.sort_order,
      })));
    }
  };

  // Build presenter list from meeting participants
  const presenterOptions: string[] = [
    ...meeting.participants,
    ...((meeting as any).external_participants || []),
  ].filter(Boolean);

  const handleSaveEdit = async () => {
    if (!editedMeeting) return;
    setLoading(true);
    try {
      const { error } = await supabase
        .from('meetings')
        .update({
          subject: editedMeeting.subject,
          request_date: selectedDate.toISOString(),
          duration: editedMeeting.duration,
          location: editedMeeting.location,
          representative: editedMeeting.representative,
          phone: editedMeeting.phone,
          notes: editedMeeting.notes,
          priority: editedMeeting.priority,
          guest_emails: selectedEmails,
        })
        .eq('id', meeting.id);
      if (error) throw error;

      // Update participants
      const newParticipants = editParticipants.split('\n').map(p => p.trim()).filter(p => p);
      await supabase.from('participants').delete().eq('meeting_id', meeting.id);
      if (newParticipants.length > 0) {
        const { error: participantsError } = await supabase
          .from('participants')
          .insert(newParticipants.map(name => ({ meeting_id: meeting.id, name })));
        if (participantsError) throw participantsError;
      }

      // Save agenda items
      await supabase.from('meeting_agenda_items').delete().eq('meeting_id', meeting.id);
      if (agendaEnabled && agendaItems.length > 0) {
        await supabase.from('meeting_agenda_items').insert(
          agendaItems.map((item, i) => ({ ...item, meeting_id: meeting.id, sort_order: i }))
        );
      }

      toast.success('جلسه با موفقیت به‌روزرسانی شد');
      onSave();
    } catch (error: any) {
      console.error('Error updating meeting:', error);
      toast.error('خطا در به‌روزرسانی جلسه');
    } finally {
      setLoading(false);
    }
  };

  const inp = 'w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white text-sm focus:ring-2 focus:ring-blue-400 focus:outline-none';

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">موضوع جلسه</label>
            <input type="text" value={editedMeeting.subject}
              onChange={(e) => setEditedMeeting({ ...editedMeeting, subject: e.target.value })}
              className={inp} />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">تاریخ و زمان</label>
            <DatePicker selected={selectedDate} onChange={(date: Date | null) => { if (date) setSelectedDate(date); }}
              showTimeSelect timeFormat="HH:mm" timeIntervals={15} dateFormat="yyyy/MM/dd HH:mm"
              className={inp} />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">مدت زمان</label>
            <input type="text" value={editedMeeting.duration}
              onChange={(e) => setEditedMeeting({ ...editedMeeting, duration: e.target.value })}
              className={inp} />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">محل برگزاری</label>
            <input type="text" value={editedMeeting.location}
              onChange={(e) => setEditedMeeting({ ...editedMeeting, location: e.target.value })}
              className={inp} />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">نماینده</label>
            <input type="text" value={editedMeeting.representative}
              onChange={(e) => setEditedMeeting({ ...editedMeeting, representative: e.target.value })}
              className={inp} />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">شماره تماس</label>
            <input type="tel" value={editedMeeting.phone}
              onChange={(e) => setEditedMeeting({ ...editedMeeting, phone: e.target.value })}
              className={inp} />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">اولویت</label>
            <select value={editedMeeting.priority}
              onChange={(e) => setEditedMeeting({ ...editedMeeting, priority: e.target.value as Meeting['priority'] })}
              className={inp}>
              <option value="high">بالا</option>
              <option value="medium">متوسط</option>
              <option value="low">پایین</option>
            </select>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">یادداشت‌ها</label>
          <textarea value={editedMeeting.notes || ''}
            onChange={(e) => setEditedMeeting({ ...editedMeeting, notes: e.target.value })}
            rows={3} className={inp} />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            شرکت‌کنندگان (هر نفر در یک خط)
          </label>
          <textarea value={editParticipants} onChange={(e) => setEditParticipants(e.target.value)}
            rows={3} className={inp}
            placeholder="نام شرکت‌کنندگان را در خط‌های جداگانه وارد کنید" />
        </div>

        {/* Agenda */}
        <div className="p-4 bg-gray-50 dark:bg-gray-700/30 rounded-lg border border-gray-200 dark:border-gray-600">
          <div className="flex items-center gap-2 mb-3">
            <input type="checkbox" id="editAgendaToggle" checked={agendaEnabled}
              onChange={(e) => setAgendaEnabled(e.target.checked)}
              className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500" />
            <label htmlFor="editAgendaToggle" className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
              <ClipboardList className="w-4 h-4" /> دستور جلسه
            </label>
          </div>

          {agendaEnabled && (
            <div className="space-y-3 mt-3">
              {agendaItems.length > 0 && (
                <div className="space-y-2">
                  {agendaItems.map((item, idx) => (
                    <div key={idx} className="flex items-center gap-2 p-2.5 bg-white dark:bg-gray-700 rounded-lg border border-gray-200 dark:border-gray-600 text-sm">
                      <span className="w-5 h-5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 text-xs flex items-center justify-center font-bold flex-shrink-0">
                        {idx + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-800 dark:text-white truncate">{item.title}</p>
                        <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400 mt-0.5 flex-wrap">
                          {item.presenter && <span className="flex items-center gap-1"><UserCheck className="w-3 h-3" />{item.presenter}</span>}
                          {item.duration_minutes != null && <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{item.duration_minutes} دقیقه</span>}
                        </div>
                      </div>
                      <button type="button"
                        onClick={() => {
                          setAgendaForm({ title: item.title, presenter: item.presenter || '', duration_minutes: item.duration_minutes != null ? String(item.duration_minutes) : '' });
                          setEditingAgendaIdx(idx);
                          setShowAgendaForm(true);
                        }}
                        className="p-1 text-gray-400 hover:text-amber-500 transition-colors">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button type="button"
                        onClick={() => setAgendaItems(prev => prev.filter((_, i) => i !== idx))}
                        className="p-1 text-gray-400 hover:text-red-500 transition-colors">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {showAgendaForm ? (
                <div className="p-3 bg-white dark:bg-gray-700 rounded-lg border border-blue-200 dark:border-blue-700 space-y-3">
                  <div>
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">عنوان دستور جلسه <span className="text-red-500">*</span></label>
                    <input type="text" value={agendaForm.title}
                      onChange={e => setAgendaForm(f => ({ ...f, title: e.target.value }))}
                      className={inp} placeholder="مثال: بررسی گزارش مالی" />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">ارائه‌دهنده</label>
                      <select value={agendaForm.presenter}
                        onChange={e => setAgendaForm(f => ({ ...f, presenter: e.target.value }))}
                        className={inp}>
                        <option value="">انتخاب ارائه‌دهنده...</option>
                        {presenterOptions.length > 0 && (
                          <optgroup label="شرکت‌کنندگان">
                            {presenterOptions.map(name => <option key={name} value={name}>{name}</option>)}
                          </optgroup>
                        )}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">مدت زمان (دقیقه)</label>
                      <input type="number" min="1" max="480" value={agendaForm.duration_minutes}
                        onChange={e => setAgendaForm(f => ({ ...f, duration_minutes: e.target.value }))}
                        className={inp} placeholder="مثال: 20" />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button type="button"
                      onClick={() => {
                        if (!agendaForm.title.trim()) { toast.error('عنوان دستور جلسه را وارد کنید'); return; }
                        const newItem = {
                          title: agendaForm.title.trim(),
                          presenter: agendaForm.presenter.trim() || null,
                          duration_minutes: agendaForm.duration_minutes ? parseInt(agendaForm.duration_minutes, 10) : null,
                          sort_order: 0,
                        };
                        if (editingAgendaIdx !== null) {
                          setAgendaItems(prev => prev.map((it, i) => i === editingAgendaIdx ? newItem : it));
                          setEditingAgendaIdx(null);
                        } else {
                          setAgendaItems(prev => [...prev, newItem]);
                        }
                        setAgendaForm({ title: '', presenter: '', duration_minutes: '' });
                        setShowAgendaForm(false);
                      }}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors">
                      <Check className="w-3.5 h-3.5" />
                      {editingAgendaIdx !== null ? 'ذخیره ویرایش' : 'افزودن دستور جلسه'}
                    </button>
                    <button type="button"
                      onClick={() => { setShowAgendaForm(false); setEditingAgendaIdx(null); setAgendaForm({ title: '', presenter: '', duration_minutes: '' }); }}
                      className="px-3 py-1.5 bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg text-sm hover:bg-gray-300 dark:hover:bg-gray-500 transition-colors">
                      انصراف
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button"
                  onClick={() => { setShowAgendaForm(true); setEditingAgendaIdx(null); setAgendaForm({ title: '', presenter: '', duration_minutes: '' }); }}
                  className="flex items-center gap-2 px-3 py-2 text-sm text-blue-600 dark:text-blue-400 border border-dashed border-blue-300 dark:border-blue-600 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors w-full justify-center">
                  <Plus className="w-4 h-4" /> ایجاد دستور جلسه
                </button>
              )}
            </div>
          )}
        </div>

        {/* Guest emails */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            <div className="flex items-center gap-2"><Users className="w-5 h-5" />انتخاب مهمانان</div>
          </label>
          {loadingContacts ? (
            <div className="flex justify-center py-4"><Loader2 className="w-6 h-6 animate-spin text-blue-500" /></div>
          ) : contacts.length === 0 ? (
            <p className="text-gray-500 dark:text-gray-400 text-sm">هیچ مخاطبی یافت نشد.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 max-h-60 overflow-y-auto p-2 border border-gray-200 dark:border-gray-700 rounded-lg">
              {contacts.map((contact) => (
                <label key={contact.id} className="flex items-center gap-2 p-2 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700">
                  <input type="checkbox" checked={selectedEmails.includes(contact.email)}
                    onChange={(e) => {
                      if (e.target.checked) setSelectedEmails([...selectedEmails, contact.email]);
                      else setSelectedEmails(selectedEmails.filter(em => em !== contact.email));
                    }}
                    className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500 dark:bg-gray-600 dark:border-gray-500" />
                  <div className="font-medium dark:text-white">{contact.name}</div>
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="flex gap-2">
          <button onClick={handleSaveEdit} disabled={loading}
            className="flex-1 flex items-center justify-center gap-2 bg-green-500 text-white py-2 rounded-lg hover:bg-green-600 disabled:opacity-50">
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
            ذخیره تغییرات
          </button>
          <button onClick={onCancel}
            className="flex-1 flex items-center justify-center gap-2 bg-gray-500 text-white py-2 rounded-lg hover:bg-gray-600">
            <X className="w-5 h-5" />انصراف
          </button>
        </div>
      </div>
    </div>
  );
}
