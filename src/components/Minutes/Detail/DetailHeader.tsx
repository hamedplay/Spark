import { ArrowRight, CreditCard as Edit2, Send, Printer, FileDown, Globe, Clock, User, History, CircleCheck as CheckCircle2 } from 'lucide-react';
import { MinutesStatusBadge, ConfidentialityBadge, ApprovalModeBadge } from '../MinutesShared';
import type { MinutesStatus, ConfidentialityLevel, ApprovalMode } from '../types';
import type { MinuteDetail, ApprovalRow } from './types';
import { formatJalaliDateForDisplay } from '../../../lib/minutesDate';

export interface DetailHeaderProps {
  minute: MinuteDetail;
  lastModified: string;
  canManage: boolean;
  myApproval: ApprovalRow | undefined;
  allApprovalsApproved: boolean;
  isSecretary: boolean;
  isChair: boolean;
  acting: boolean;
  printLoading: boolean;
  wordLoading: boolean;
  onNavigateBack: () => void;
  onEdit: () => void;
  onApprove: () => void;
  onRequestChanges: () => void;
  onSecretaryConfirm: () => void;
  onChairPublish: () => void;
  onPrint: () => void;
  onWordExport: () => void;
}

export function DetailHeader({
  minute, lastModified, canManage, myApproval, allApprovalsApproved, isSecretary, isChair, acting, printLoading, wordLoading,
  onNavigateBack, onEdit, onApprove, onRequestChanges, onSecretaryConfirm, onChairPublish, onPrint, onWordExport,
}: DetailHeaderProps) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <MinutesStatusBadge status={minute.status as MinutesStatus} />
            <ConfidentialityBadge level={minute.confidentiality as ConfidentialityLevel} />
            {minute.approval_mode && <ApprovalModeBadge mode={minute.approval_mode as ApprovalMode} />}
            {minute.revision_number > 1 && (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                نسخه {minute.revision_number}
              </span>
            )}
          </div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white leading-snug">{minute.meeting_title_snapshot}</h1>
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-sm text-gray-500 dark:text-gray-400">
            <span className="flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" />
              {formatJalaliDateForDisplay(minute.meeting_date_snapshot)}
            </span>
            <span className="flex items-center gap-1.5">
              <User className="w-3.5 h-3.5" />
              دبیر: {minute.secretary_name_snapshot}
            </span>
            <span className="flex items-center gap-1.5">
              <User className="w-3.5 h-3.5" />
              رئیس: {minute.chair_name_snapshot}
            </span>
            <span className="flex items-center gap-1.5">
              <History className="w-3.5 h-3.5" />
              آخرین ویرایش: {lastModified}
            </span>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={onNavigateBack}
            aria-label="بازگشت"
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            <ArrowRight className="w-4 h-4" />
            بازگشت
          </button>
          {(minute.status === 'draft' || minute.status === 'changes_requested') && canManage && (
            <button
              onClick={onEdit}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
            >
              <Edit2 className="w-4 h-4" />
              ویرایش و اصلاح
            </button>
          )}
          {/* Approver: Approve button (system mode, pending_approval, my approval is pending) */}
          {minute.status === 'pending_approval' && minute.approval_mode === 'system' && myApproval && (
            <button
              onClick={onApprove}
              disabled={acting}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm bg-green-600 hover:bg-green-700 text-white transition-colors disabled:opacity-50"
            >
              <CheckCircle2 className="w-4 h-4" />
              {acting ? 'در حال...' : 'تأیید'}
            </button>
          )}
          {/* Approver: Request changes button */}
          {minute.status === 'pending_approval' && minute.approval_mode === 'system' && myApproval && (
            <button
              onClick={onRequestChanges}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm bg-orange-500 hover:bg-orange-600 text-white transition-colors"
            >
              <Send className="w-4 h-4" />
              درخواست اصلاح
            </button>
          )}
          {/* Secretary: Confirm button */}
          {isSecretary && !minute.secretary_confirmed_at &&
           ((minute.approval_mode === 'system' && minute.status === 'approved') ||
            (minute.approval_mode === 'in_person' && minute.status === 'pending_approval')) && (
            <button
              onClick={onSecretaryConfirm}
              disabled={acting}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm bg-teal-600 hover:bg-teal-700 text-white transition-colors disabled:opacity-50"
            >
              <CheckCircle2 className="w-4 h-4" />
              {acting ? 'در حال...' : 'تأیید دبیر'}
            </button>
          )}
          {/* Chair: Publish button */}
          {isChair && minute.secretary_confirmed_at && minute.status !== 'published' && (
            (minute.approval_mode === 'system' && allApprovalsApproved) ||
            minute.approval_mode === 'in_person'
          ) && (
            <button
              onClick={onChairPublish}
              disabled={acting}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-50"
            >
              <Globe className="w-4 h-4" />
              {acting ? 'در حال...' : 'تأیید و انتشار'}
            </button>
          )}
          <button
            onClick={onPrint}
            disabled={printLoading || !minute}
            title="چاپ / ذخیره PDF"
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Printer className="w-4 h-4" />
            {printLoading ? 'در حال آماده‌سازی...' : 'چاپ / ذخیره PDF'}
          </button>
          <button
            onClick={onWordExport}
            disabled={wordLoading || !minute}
            aria-label="خروجی Word"
            title="خروجی Word"
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <FileDown className="w-4 h-4" />
            {wordLoading ? 'در حال ساخت Word...' : 'خروجی Word'}
          </button>
        </div>
      </div>
    </div>
  );
}
