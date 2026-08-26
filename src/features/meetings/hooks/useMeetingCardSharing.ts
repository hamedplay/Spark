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
  closeShareDialog: () => void;
  handleShareImage: () => Promise<void>;
  handleShareText: () => Promise<void>;
  handleSendToTelegram: () => Promise<void>;
  handleNativeShareImage: () => Promise<void>;
  handleDownloadShareImage: () => void;
}

function dataUrlToBlob(dataUrl: string): Blob {
  const commaIndex = dataUrl.indexOf(',');
  if (commaIndex < 0) throw new Error('INVALID_DATA_URL');
  const metadata = dataUrl.slice(0, commaIndex);
  const payload = dataUrl.slice(commaIndex + 1);
  const mimeType = /^data:([^;,]+)/.exec(metadata)?.[1] || 'application/octet-stream';
  if (metadata.includes(';base64')) {
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return new Blob([bytes], { type: mimeType });
  }
  return new Blob([decodeURIComponent(payload)], { type: mimeType });
}

function waitForImageReady(dataUrl: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('IMAGE_PRELOAD_FAILED'));
    image.src = dataUrl;
  });
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
      if (shareMenuRef.current && !shareMenuRef.current.contains(e.target as Node)) setShowShareMenu(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const toggleShareMenu = () => setShowShareMenu(v => !v);
  const closeShareDialog = () => {
    setShowShareDialog(false);
    setShareImageUrl(null);
  };

  const handleShareImage = async () => {
    setShowShareMenu(false);
    if (!shareCardRef.current) { toast.error('خطا در ایجاد تصویر'); return; }
    try {
      setLoading(true);
      toast.loading('در حال تولید تصویر...');
      const dataUrl = await toPng(shareCardRef.current, { quality: 0.95, pixelRatio: 2, backgroundColor: '#ffffff' });
      await waitForImageReady(dataUrl);
      toast.dismiss();
      setShareImageUrl(dataUrl);
      setShowShareDialog(true);
    } catch {
      toast.dismiss();
      toast.error('خطا در ایجاد تصویر');
    } finally {
      setLoading(false);
    }
  };

  const handleShareText = async () => {
    setShowShareMenu(false);
    const dateStr = new Date(meeting.requestDate).toLocaleDateString('fa-IR');
    const timeStr = meeting.start_time && meeting.end_time ? `${meeting.start_time} - ${meeting.end_time}` : meeting.duration;
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
      await navigator.clipboard.writeText(lines);
      toast.success('متن جلسه در کلیپ‌بورد کپی شد');
    } catch {
      toast.error('خطا در کپی متن جلسه');
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

  const handleNativeShareImage = async () => {
    if (!shareImageUrl) return;
    try {
      const blob = dataUrlToBlob(shareImageUrl);
      const file = new File([blob], `meeting-${meeting.id.slice(0, 8)}.png`, { type: 'image/png' });
      if (!navigator.share || !(navigator.canShare?.({ files: [file] }) ?? false)) {
        toast.error('اشتراک‌گذاری مستقیم تصویر در این مرورگر پشتیبانی نمی‌شود');
        return;
      }
      await navigator.share({ title: meeting.subject, files: [file] });
      toast.success('تصویر جلسه به اشتراک گذاشته شد');
    } catch (error: any) {
      if (error?.name !== 'AbortError') toast.error('خطا در اشتراک‌گذاری تصویر');
    }
  };

  const handleDownloadShareImage = () => {
    if (!shareImageUrl) return;
    const a = document.createElement('a');
    a.href = shareImageUrl;
    a.download = `meeting-${meeting.id.slice(0, 8)}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    toast.success('تصویر PNG دانلود شد');
  };

  return {
    cardRef,
    shareCardRef,
    shareMenuRef,
    showShareMenu,
    showShareDialog,
    shareImageUrl,
    toggleShareMenu,
    closeShareDialog,
    handleShareImage,
    handleShareText,
    handleSendToTelegram,
    handleNativeShareImage,
    handleDownloadShareImage,
  };
}
