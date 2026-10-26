import { useLiveData, LIVE_DATA } from '../../../../shared/realtime/useLiveData';
import { formatMeetingRequestDate } from '../../formatMeetingRequestDate';
import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useModalFocus } from '../../../../app/layout/hooks/useModalFocus';
import { Calendar, Clock, MapPin, User, X, Check, Loader as Loader2, CircleAlert as AlertCircle, RefreshCw, Phone } from 'lucide-react';
import { supabase } from '../../../../lib/supabase';
import toast from 'react-hot-toast';

interface PendingMeetingsModalProps {
  onClose: () => void;
  onUpdate: () => void;
}

export function PendingMeetingsModal({ onClose, onUpdate }: PendingMeetingsModalProps) {
  const liveRefreshRef = useLiveData(LIVE_DATA.meetings, async () => { if (!processingMeetingId) await fetchPendingMeetings(); });
  const panelRef = useRef<HTMLDivElement>(null);
  useModalFocus(true, panelRef, onClose);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, []);

  const [pendingMeetings, setPendingMeetings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [processingMeetingId, setProcessingMeetingId] = useState<string | null>(null);

  const priorityColors = {
    high: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
    medium: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
    low: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  };

  useEffect(() => {
    fetchPendingMeetings();
  }, []);

  const fetchPendingMeetings = async () => {
    try {
      if (!liveRefreshRef.current) setLoading(true);
      setError(null);
      
      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setError('لطفا ابتدا وارد حساب کاربری خود شوید');
        return;
      }
      
      // Fetch meetings that were shared with this user and are pending approval
      const { data, error } = await supabase
        .from('shared_meetings')
        .select(`
          id,
          meeting_id,
          sender_id,
          sender_name,
          recipient_id,
          status,
          created_at,
          meeting_data
        `)
        .eq('recipient_id', user.id)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });

      if (error) throw error;
      
      // Process real data to use meeting_data if available
      const processedData = (data || []).map(item => {
        // If we have meeting_data, use it directly
        if (item.meeting_data) {
          return {
            ...item,
            meeting: item.meeting_data
          };
        }
        
        // Otherwise, try to fetch the meeting data from the meetings table
        return {
          ...item,
          meeting: null // Will be fetched separately if needed
        };
      });
      
      let combinedMeetings = [...processedData];
      
      // For any items without meeting data, try to fetch from meetings table
      for (let i = 0; i < combinedMeetings.length; i++) {
        const item = combinedMeetings[i];
        if (!item.meeting) {
          try {
            const { data: meetingData, error: meetingError } = await supabase
              .from('meetings')
              .select('subject, request_date, request_jalaali_date, duration, location, representative, phone, notes, priority')
              .eq('id', item.meeting_id)
              .single();
            
            if (!meetingError && meetingData) {
              combinedMeetings[i] = {
                ...item,
                meeting: meetingData
              };
              
              // Update the shared_meeting record with the meeting_data for future use
              await supabase
                .from('shared_meetings')
                .update({ meeting_data: meetingData })
                .eq('id', item.id);
            }
          } catch (err) {
            console.error('Error fetching meeting details:', err);
          }
        }
      }
      
      setPendingMeetings(combinedMeetings);
    } catch (error: any) {
      console.error('Error fetching pending meetings:', error);
      setError('خطا در دریافت جلسات در انتظار تایید');
    } finally {
      setLoading(false);
    }
  };

  const handleApproveMeeting = async (sharedMeetingId: string, meetingData: any) => {
    if (!meetingData) {
      toast.error('اطلاعات جلسه در دسترس نیست');
      return;
    }
    
    try {
      setProcessingMeetingId(sharedMeetingId);
      
      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast.error('لطفا ابتدا وارد حساب کاربری خود شوید');
        return;
      }
      
      // Create a new meeting for the user
      const { error } = await supabase
        .from('meetings')
        .insert([{
          subject: meetingData.subject,
          request_date: meetingData.request_date,
          request_jalaali_date: meetingData.request_jalaali_date,
          duration: meetingData.duration,
          location: meetingData.location,
          representative: meetingData.representative,
          phone: meetingData.phone,
          notes: meetingData.notes,
          priority: meetingData.priority,
          status: 'open',
          status_type: 'approved',
          user_id: user.id
        }])
        .select()
        .single();
      
      if (error) throw error;
      
      // Update shared meeting status
      const { error: updateError } = await supabase
        .from('shared_meetings')
        .update({ status: 'approved' })
        .eq('id', sharedMeetingId);
      
      if (updateError) throw updateError;
      
      toast.success('جلسه با موفقیت تایید و به لیست جلسات شما اضافه شد');
      fetchPendingMeetings();
      onUpdate();
    } catch (error: any) {
      console.error('Error approving meeting:', error);
      toast.error('خطا در تایید جلسه');
    } finally {
      setProcessingMeetingId(null);
    }
  };

  const handleRejectMeeting = async (sharedMeetingId: string) => {
    try {
      setProcessingMeetingId(sharedMeetingId);
      
      // Update shared meeting status
      const { error } = await supabase
        .from('shared_meetings')
        .update({ status: 'rejected' })
        .eq('id', sharedMeetingId);
      
      if (error) throw error;
      
      toast.success('درخواست جلسه رد شد');
      
      // Refresh pending meetings list
      fetchPendingMeetings();
      onUpdate();
    } catch (error: any) {
      console.error('Error rejecting meeting:', error);
      toast.error('خطا در رد جلسه');
    } finally {
      setProcessingMeetingId(null);
    }
  };

  return createPortal(
    <div dir="rtl" className="fixed inset-0 z-[200] flex items-end justify-center bg-slate-950/50 p-2 backdrop-blur-sm sm:items-center sm:p-6" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="pending-meetings-title" tabIndex={-1} className="flex max-h-[calc(100dvh-1rem)] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl outline-none dark:bg-gray-900 sm:max-h-[85dvh]">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-gray-100 px-4 py-3 dark:border-gray-800 sm:px-6">
          <div className="min-w-0">
            <h3 id="pending-meetings-title" className="text-base font-bold text-gray-900 dark:text-white">جلسات در انتظار تأیید</h3>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">درخواست‌های دریافتی را بررسی، تأیید یا رد کنید.</p>
          </div>
          <button
            onClick={onClose}
            type="button" aria-label="بستن"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 sm:p-6">
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
            </div>
          ) : error ? (
            <div className="text-center py-8">
              <div className="flex items-center justify-center gap-2 text-red-500 dark:text-red-400 mb-4">
                <AlertCircle className="w-6 h-6" />
                <p className="text-lg">{error}</p>
              </div>
              <button 
                onClick={fetchPendingMeetings}
                className="mt-2 px-6 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 flex items-center gap-2 mx-auto"
              >
                <RefreshCw className="w-5 h-5" />
                تلاش مجدد
              </button>
            </div>
          ) : pendingMeetings.length === 0 ? (
            <div className="text-center py-16">
              <p className="text-gray-500 dark:text-gray-400 text-lg">هیچ جلسه‌ای در انتظار تایید وجود ندارد</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {pendingMeetings.map((pendingMeeting) => (
                <div key={pendingMeeting.id} className="flex min-w-0 flex-col rounded-2xl border border-gray-200 p-4 dark:border-gray-700">
                  {pendingMeeting.meeting ? (
                    <>
                      <div className="flex flex-wrap items-start justify-between gap-2 mb-4">
                        <div className="min-w-0 flex-1 basis-40">
                          <h4 className="break-words font-bold text-base text-gray-900 dark:text-white">{pendingMeeting.meeting.subject}</h4>
                          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                            ارسال شده توسط: {pendingMeeting.sender_name}
                          </p>
                        </div>
                        <span className={`inline-flex shrink-0 items-center whitespace-nowrap px-2 py-1 rounded-lg text-[10px] font-medium ${
                          priorityColors[pendingMeeting.meeting.priority as keyof typeof priorityColors]
                        }`}>
                          {pendingMeeting.meeting.priority === 'high' ? 'اولویت بالا' : 
                          pendingMeeting.meeting.priority === 'medium' ? 'اولویت متوسط' : 'اولویت پایین'}
                        </span>
                      </div>
                      
                      <div className="grid grid-cols-1 gap-3 mb-4 min-[420px]:grid-cols-2">
                        <div className="flex min-w-0 items-start break-words text-gray-600 dark:text-gray-300">
                          <Calendar className="w-4 h-4 ml-2 flex-shrink-0" />
                          <span className="text-sm">{formatMeetingRequestDate(pendingMeeting.meeting.request_date, pendingMeeting.meeting.request_jalaali_date)}</span>
                        </div>
                        <div className="flex min-w-0 items-start break-words text-gray-600 dark:text-gray-300">
                          <Clock className="w-4 h-4 ml-2 flex-shrink-0" />
                          <span className="min-w-0 text-sm">{pendingMeeting.meeting.duration}</span>
                        </div>
                        <div className="flex min-w-0 items-start break-words text-gray-600 dark:text-gray-300">
                          <MapPin className="w-4 h-4 ml-2 flex-shrink-0" />
                          <span className="min-w-0 text-sm">{pendingMeeting.meeting.location}</span>
                        </div>
                        <div className="flex min-w-0 items-start break-words text-gray-600 dark:text-gray-300">
                          <User className="w-4 h-4 ml-2 flex-shrink-0" />
                          <span className="min-w-0 text-sm">{pendingMeeting.meeting.representative}</span>
                        </div>
                        {pendingMeeting.meeting.phone && (
                          <div className="flex min-w-0 items-start break-words text-gray-600 dark:text-gray-300">
                            <Phone className="w-4 h-4 ml-2 flex-shrink-0" />
                            <span dir="ltr" className="min-w-0 text-sm">{pendingMeeting.meeting.phone}</span>
                          </div>
                        )}
                      </div>
                      
                      {pendingMeeting.meeting.notes && (
                        <div className="mb-4 text-sm text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-gray-700 p-3 rounded-lg">
                          <p className="whitespace-pre-wrap break-words">{pendingMeeting.meeting.notes}</p>
                        </div>
                      )}
                      
                      <div className="grid grid-cols-1 gap-2 mt-auto pt-4 min-[420px]:grid-cols-2">
                        <button
                          onClick={() => handleApproveMeeting(pendingMeeting.id, pendingMeeting.meeting)}
                          disabled={processingMeetingId !== null}
                          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                        >
                          {processingMeetingId === pendingMeeting.id ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Check className="w-4 h-4" />
                          )}
                          تایید و افزودن به جلسات
                        </button>
                        <button
                          onClick={() => handleRejectMeeting(pendingMeeting.id)}
                          disabled={processingMeetingId !== null}
                          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-red-200 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
                        >
                          {processingMeetingId === pendingMeeting.id ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <X className="w-4 h-4" />
                          )}
                          رد درخواست
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="text-center py-6">
                      <div className="flex flex-col items-center justify-center gap-2 text-yellow-600 dark:text-yellow-400 mb-4">
                        <AlertCircle className="w-10 h-10 mb-2" />
                        <p className="font-medium dark:text-yellow-300">اطلاعات این جلسه در دسترس نیست</p>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                          ارسال شده توسط: {pendingMeeting.sender_name}
                        </p>
                      </div>
                      <div className="flex gap-2 mt-4 justify-center">
                        <button
                          onClick={() => handleRejectMeeting(pendingMeeting.id)}
                          disabled={processingMeetingId !== null}
                          className="flex items-center justify-center gap-1 bg-red-500 text-white px-6 py-2 rounded-lg hover:bg-red-600 disabled:opacity-70"
                        >
                          {processingMeetingId === pendingMeeting.id ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <X className="w-4 h-4" />
                          )}
                          رد درخواست
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
