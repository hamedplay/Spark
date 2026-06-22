import React, { useState, useEffect } from 'react';
import { Save, X, Loader2, Users } from 'lucide-react';
import { Meeting } from '../../types';
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

  useEffect(() => {
    fetchContacts();
  }, []);

  const fetchContacts = async () => {
    try {
      setLoadingContacts(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from('contacts_email')
        .select('*')
        .eq('user_id', user.id)
        .order('name');

      if (error) throw error;
      setContacts(data || []);
    } catch (error) {
      console.error('Error fetching contacts:', error);
      toast.error('خطا در دریافت لیست مخاطبین');
    } finally {
      setLoadingContacts(false);
    }
  };

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
          guest_emails: selectedEmails
        })
        .eq('id', meeting.id);

      if (error) throw error;

      // Update participants
      const newParticipants = editParticipants
        .split('\n')
        .map(p => p.trim())
        .filter(p => p);

      // Delete existing participants
      await supabase
        .from('participants')
        .delete()
        .eq('meeting_id', meeting.id);

      // Add new participants
      if (newParticipants.length > 0) {
        const { error: participantsError } = await supabase
          .from('participants')
          .insert(
            newParticipants.map(name => ({
              meeting_id: meeting.id,
              name
            }))
          );

        if (participantsError) throw participantsError;
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

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              موضوع جلسه
            </label>
            <input
              type="text"
              value={editedMeeting.subject}
              onChange={(e) => setEditedMeeting({ ...editedMeeting, subject: e.target.value })}
              className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              تاریخ و زمان
            </label>
            <DatePicker
              selected={selectedDate}
              onChange={(date: Date) => setSelectedDate(date)}
              showTimeSelect
              timeFormat="HH:mm"
              timeIntervals={15}
              dateFormat="yyyy/MM/dd HH:mm"
              className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              مدت زمان
            </label>
            <input
              type="text"
              value={editedMeeting.duration}
              onChange={(e) => setEditedMeeting({ ...editedMeeting, duration: e.target.value })}
              className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              محل برگزاری
            </label>
            <input
              type="text"
              value={editedMeeting.location}
              onChange={(e) => setEditedMeeting({ ...editedMeeting, location: e.target.value })}
              className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              نماینده
            </label>
            <input
              type="text"
              value={editedMeeting.representative}
              onChange={(e) => setEditedMeeting({ ...editedMeeting, representative: e.target.value })}
              className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              شماره تماس
            </label>
            <input
              type="tel"
              value={editedMeeting.phone}
              onChange={(e) => setEditedMeeting({ ...editedMeeting, phone: e.target.value })}
              className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              اولویت
            </label>
            <select
              value={editedMeeting.priority}
              onChange={(e) => setEditedMeeting({ ...editedMeeting, priority: e.target.value as Meeting['priority'] })}
              className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white"
            >
              <option value="high">بالا</option>
              <option value="medium">متوسط</option>
              <option value="low">پایین</option>
            </select>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            یادداشت‌ها
          </label>
          <textarea
            value={editedMeeting.notes || ''}
            onChange={(e) => setEditedMeeting({ ...editedMeeting, notes: e.target.value })}
            rows={3}
            className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white"
          ></textarea>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            شرکت‌کنندگان (هر نفر در یک خط)
          </label>
          <textarea
            value={editParticipants}
            onChange={(e) => setEditParticipants(e.target.value)}
            rows={3}
            className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white"
            placeholder="نام شرکت‌کنندگان را در خط‌های جداگانه وارد کنید"
          ></textarea>
        </div>

        {/* بخش انتخاب ایمیل‌های مهمانان */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            <div className="flex items-center gap-2">
              <Users className="w-5 h-5" />
              انتخاب مهمانان
            </div>
          </label>
          {loadingContacts ? (
            <div className="flex justify-center py-4">
              <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
            </div>
          ) : contacts.length === 0 ? (
            <p className="text-gray-500 dark:text-gray-400 text-sm">هیچ مخاطبی یافت نشد. لطفا ابتدا از بخش مخاطبین ایمیل، مخاطب اضافه کنید.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 max-h-60 overflow-y-auto p-2 border border-gray-200 dark:border-gray-700 rounded-lg">
              {contacts.map((contact) => (
                <label key={contact.id} className="flex items-center gap-2 p-2 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700">
                  <input
                    type="checkbox"
                    checked={selectedEmails.includes(contact.email)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedEmails([...selectedEmails, contact.email]);
                      } else {
                        setSelectedEmails(selectedEmails.filter(email => email !== contact.email));
                      }
                    }}
                    className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500 dark:bg-gray-600 dark:border-gray-500"
                  />
                  <div className="font-medium dark:text-white">{contact.name}</div>
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="flex gap-2">
          <button
            onClick={handleSaveEdit}
            disabled={loading}
            className="flex-1 flex items-center justify-center gap-2 bg-green-500 text-white py-2 rounded-lg hover:bg-green-600 disabled:opacity-50"
          >
            {loading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <Save className="w-5 h-5" />
            )}
            ذخیره تغییرات
          </button>
          <button
            onClick={onCancel}
            className="flex-1 flex items-center justify-center gap-2 bg-gray-500 text-white py-2 rounded-lg hover:bg-gray-600"
          >
            <X className="w-5 h-5" />
            انصراف
          </button>
        </div>
      </div>
    </div>
  );
}