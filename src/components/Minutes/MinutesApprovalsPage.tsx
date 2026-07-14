import { useState } from 'react';
import { Check, X, MessageSquare, Eye } from 'lucide-react';
import { PageHeader, MinutesStatusBadge, ApprovalStatusBadge } from './MinutesShared';
import { MOCK_MINUTES, MOCK_APPROVALS } from './mockData';

type TabKey = 'pending' | 'approved' | 'rejected' | 'all';

interface Props {
  onNavigate: (page: string) => void;
}

export function MinutesApprovalsPage({ onNavigate }: Props) {
  const [activeTab, setActiveTab] = useState<TabKey>('pending');
  const [actionModal, setActionModal] = useState<{ type: 'approve' | 'reject'; minuteTitle: string } | null>(null);
  const [noteModal, setNoteModal] = useState<{ minuteTitle: string } | null>(null);
  const [noteText, setNoteText] = useState('');

  // Mock rows combining minutes + approvals data
  const rows = MOCK_MINUTES.map((m, i) => ({
    ...m,
    approvalStage: `مرحله ${(i % 3) + 1}`,
    approvalType: MOCK_APPROVALS[i % MOCK_APPROVALS.length].method,
    sentDate: m.lastModified,
    myStatus: MOCK_APPROVALS[i % MOCK_APPROVALS.length].status,
  }));

  const filtered = rows.filter(r => {
    if (activeTab === 'pending') return r.myStatus === 'pending';
    if (activeTab === 'approved') return r.myStatus === 'approved';
    if (activeTab === 'rejected') return r.myStatus === 'rejected';
    return true;
  });

  const TABS: { key: TabKey; label: string; count: number }[] = [
    { key: 'pending',  label: 'در انتظار تأیید من', count: rows.filter(r => r.myStatus === 'pending').length },
    { key: 'approved', label: 'تأییدشده توسط من',   count: rows.filter(r => r.myStatus === 'approved').length },
    { key: 'rejected', label: 'ردشده توسط من',       count: rows.filter(r => r.myStatus === 'rejected').length },
    { key: 'all',      label: 'همه موارد',           count: rows.length },
  ];

  return (
    <div dir="rtl" className="space-y-5">
      <PageHeader title="کارتابل تأیید" description="مدیریت درخواست‌های تأیید صورت‌جلسات" />

      {/* Tabs */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700">
        <div className="flex overflow-x-auto border-b border-gray-100 dark:border-gray-700">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                activeTab === t.key
                  ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
              }`}
            >
              {t.label}
              {t.count > 0 && (
                <span className={`px-1.5 py-0.5 rounded-full text-xs font-semibold ${
                  activeTab === t.key ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
                }`}>
                  {t.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-100 dark:border-gray-700">
                {['عنوان جلسه','تاریخ جلسه','دبیر','مرحله تأیید','نوع تأیید','تاریخ ارسال','وضعیت','عملیات'].map(h => (
                  <th key={h} className="px-4 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
              {filtered.map(row => (
                <tr key={row.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/40 transition-colors">
                  <td className="px-4 py-3">
                    <button
                      onClick={() => onNavigate('minutes-detail')}
                      className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline text-right"
                    >
                      {row.meetingTitle}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-gray-700 dark:text-gray-300 whitespace-nowrap">{row.meetingDate}</td>
                  <td className="px-4 py-3 text-gray-700 dark:text-gray-300 whitespace-nowrap">{row.secretary}</td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400 whitespace-nowrap">{row.approvalStage}</td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400 whitespace-nowrap">
                    {row.approvalType === 'digital' ? 'سیستمی' : 'حضوری'}
                  </td>
                  <td className="px-4 py-3 text-gray-500 dark:text-gray-400 whitespace-nowrap text-xs">{row.sentDate}</td>
                  <td className="px-4 py-3">
                    <ApprovalStatusBadge status={row.myStatus} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => onNavigate('minutes-detail')}
                        aria-label="مشاهده"
                        title="مشاهده"
                        className="p-1.5 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 text-blue-500 transition-colors"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                      {row.myStatus === 'pending' && (
                        <>
                          <button
                            onClick={() => setActionModal({ type: 'approve', minuteTitle: row.meetingTitle })}
                            aria-label="تأیید"
                            title="تأیید"
                            className="p-1.5 rounded-lg hover:bg-green-50 dark:hover:bg-green-900/20 text-green-500 transition-colors"
                          >
                            <Check className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setActionModal({ type: 'reject', minuteTitle: row.meetingTitle })}
                            aria-label="رد"
                            title="رد"
                            className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-red-500 transition-colors"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </>
                      )}
                      <button
                        onClick={() => setNoteModal({ minuteTitle: row.meetingTitle })}
                        aria-label="ثبت توضیح"
                        title="ثبت توضیح"
                        className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 transition-colors"
                      >
                        <MessageSquare className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {filtered.length === 0 && (
            <div className="py-12 text-center text-sm text-gray-500 dark:text-gray-400">
              موردی برای نمایش وجود ندارد.
            </div>
          )}
        </div>
      </div>

      {/* Approve / Reject modal */}
      {actionModal && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" dir="rtl">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
              <h3 className="font-bold text-gray-900 dark:text-white">
                {actionModal.type === 'approve' ? 'تأیید صورت‌جلسه' : 'رد صورت‌جلسه'}
              </h3>
              <button onClick={() => setActionModal(null)} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {actionModal.type === 'approve' ? 'تأیید' : 'رد'} صورت‌جلسه:
                <span className="font-medium text-gray-800 dark:text-gray-200"> {actionModal.minuteTitle}</span>
              </p>
              <div>
                <label htmlFor="approval-note" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  توضیحات {actionModal.type === 'reject' ? '(الزامی)' : '(اختیاری)'}
                </label>
                <textarea
                  id="approval-note"
                  rows={3}
                  className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:bg-gray-700 dark:text-white resize-none"
                  placeholder="توضیحات خود را وارد کنید..."
                />
              </div>
            </div>
            <div className="flex gap-3 px-5 pb-5">
              <button
                onClick={() => setActionModal(null)}
                className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-colors ${
                  actionModal.type === 'approve'
                    ? 'bg-green-500 hover:bg-green-600 text-white'
                    : 'bg-red-500 hover:bg-red-600 text-white'
                }`}
              >
                {actionModal.type === 'approve' ? 'تأیید' : 'رد'}
              </button>
              <button
                onClick={() => setActionModal(null)}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 transition-colors"
              >
                انصراف
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Note modal */}
      {noteModal && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" dir="rtl">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
              <h3 className="font-bold text-gray-900 dark:text-white">ثبت توضیح</h3>
              <button onClick={() => setNoteModal(null)} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5">
              <textarea
                id="note-text"
                rows={4}
                value={noteText}
                onChange={e => setNoteText(e.target.value)}
                className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:bg-gray-700 dark:text-white resize-none"
                placeholder="توضیحات..."
              />
            </div>
            <div className="flex gap-3 px-5 pb-5">
              <button
                onClick={() => { setNoteModal(null); setNoteText(''); }}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white transition-colors"
              >
                ذخیره
              </button>
              <button
                onClick={() => { setNoteModal(null); setNoteText(''); }}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 transition-colors"
              >
                انصراف
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Inline status badge for minutes */}
      {filtered.length > 0 && (
        <div className="hidden">
          <MinutesStatusBadge status="draft" />
        </div>
      )}
    </div>
  );
}
