import { useState, useRef, useEffect, type RefObject } from 'react';
import type { Meeting, AgendaItem } from '../../../types';
import { sendMeetingToTelegram } from '../../../lib/telegram';
import toast from 'react-hot-toast';
import { toPng } from 'html-to-image';

interface UseMeetingCardSharingParams {
  meeting: Meeting;
  agendaItems: AgendaItem[];
  setLoading: (loading: boolean) => void;
}

interface UseMeetingCardSharingResult {
  cardRef: RefObject<HTMLDivElement | null>;
  shareCardRef: RefObject<HTMLDivElement | null>;
  shareMenuRef: RefObject<HTMLDivElement | null>;

  showShareMenu: boolean;
  showShareDialog: boolean;
  shareImageUrl: string | null;

  toggleShareMenu: () => void;
  closeShareMenu: () => void;
  closeShareDialog: () => void;

  handleShareImage: () => Promise<void>;
  handleShareText: () => Promise<void>;
  handleSendToTelegram: () => Promise<void>;
  handleDownloadShareImage: () => void;
}

export function useMeetingCardSharing({ meeting, agendaItems, setLoading }: UseMeetingCardSharingParams): UseMeetingCardSharingResult {
  const [showShareMenu, setShowShareMenu] = useState(false);
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [shareImageUrl, setShareImageUrl] = useState<string | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const shareCardRef = useRef<HTMLDivElement | null>(null);
  const shareMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (shareMenuRef.current && !shareMenuRef.current.contains(e.target as Node)) {
        setShowShareMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const toggleShareMenu = () => setShowShareMenu(v => !v);
  const closeShareMenu = () => setShowShareMenu(false);
  const closeShareDialog = () => setShowShareDialog(false);

  const handleShareImage = async () => {
    setShowShareMenu(false);
    if (!shareCardRef.current) { toast.error('خطا در ایجاد تصویر'); return; }
    try {
      setLoading(true);
      toast.loading('در حال تولید تصویر...');
      const dataUrl = await toPng(shareCardRef.current, { quality: 0.95, pixelRatio: 2 });
      toast.dismiss();
      const blob = await (await fetch(dataUrl)).blob();
      const file = new File([blob], 'meeting.png', { type: 'image/png' });
      if (navigator.share && (navigator.canShare?.({ files: [file] }) ?? false)) {
        await navigator.share({ title: meeting.subject, files: [file] });
      } else {
        setShareImageUrl(dataUrl);
        setShowShareDialog(true);
      }
    } catch {
      toast.dismiss();
      toast.error('خطا در اشتراک‌گذاری');
    } finally {
      setLoading(false);
    }
  };

  const handleShareText = async () => {
    setShowShareMenu(false);
    const dateStr = new Date(meeting.requestDate).toLocaleDateString('fa-IR');
    const timeStr = meeting.start_time && meeting.end_time
      ? `${meeting.start_time} - ${meeting.end_time}`
      : meeting.duration;
    const agendaText = agendaItems.length > 0
      ? `📌 دستور جلسه:\n` + agendaItems.map((item, idx) => {
          const parts = [`${idx + 1}. ${item.title}`];
          if (item.presenter) parts.push(`ارائه‌دهنده: ${item.presenter}`);
          if (item.duration_minutes) parts.push(`${item.duration_minutes} دقیقه`);
          return parts.join(' | ');
        }).join('\n')
      : '';
    const lines = [
      `📋 جلسه: ${meeting.subject}`,
      `📅 تاریخ: ${dateStr}`,
      `⏰ زمان: ${timeStr}`,
      `📍 محل: ${meeting.location}`,
      `👤 نماینده: ${meeting.representative}`,
      `📞 تلفن: ${meeting.phone}`,
      meeting.participants.length > 0 ? `👥 شرکت‌کنندگان: ${meeting.participants.join('، ')}` : '',
      meeting.notes ? `📝 یادداشت: ${meeting.notes}` : '',
      agendaText,
      `\nسیستم مدیریت جلسات اسپارک`,
    ].filter(Boolean).join('\n');

    try {
      if (navigator.share) {
        await navigator.share({ title: meeting.subject, text: lines });
      } else {
        await navigator.clipboard.writeText(lines);
        toast.success('متن جلسه در کلیپ‌بورد کپی شد');
      }
    } catch {
      try {
        await navigator.clipboard.writeText(lines);
        toast.success('متن جلسه در کلیپ‌بورد کپی شد');
      } catch {
        toast.error('خطا در اشتراک‌گذاری متن');
      }
    }
  };

  const handleSendToTelegram = async () => {
    if (meeting.status_type !== 'requested') {
      toast.error('فقط جلسات در وضعیت درخواست شده قابل ارسال به مدیر هستند');
      return;
    }
    try {
      setLoading(true);
      const imageData = await toPng(cardRef.current, { quality: 0.95, backgroundColor: 'white' });
      await sendMeetingToTelegram(meeting.id, imageData);
      toast.success('جلسه با موفقیت به مدیر ارسال شد');
    } catch {
      toast.error('خطا در ارسال به مدیر');
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadShareImage = () => {
    if (!shareImageUrl) return;
    const a = document.createElement('a');
    a.href = shareImageUrl;
    a.download = `meeting-${meeting.id.slice(0, 8)}.png`;
    a.click();
    toast.success('تصویر دانلود شد');
    setShowShareDialog(false);
  };

  return {
    cardRef,
    shareCardRef,
    shareMenuRef,
    showShareMenu,
    showShareDialog,
    shareImageUrl,
    toggleShareMenu,
    closeShareMenu,
    closeShareDialog,
    handleShareImage,
    handleShareText,
    handleSendToTelegram,
    handleDownloadShareImage,
  };
}
