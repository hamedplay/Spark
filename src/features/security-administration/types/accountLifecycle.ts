export interface LifecycleUser {
  user_id: string;
  full_name: string;
  username: string;
  masked_email: string;
  masked_phone: string;
  account_status: string;
  is_active: boolean;
  phone_verified: boolean;
  profile_completion_status: string;
  account_lifecycle_version: number;
  created_at: string;
  eligibility: {
    can_approve: boolean;
    can_reject: boolean;
    can_reopen: boolean;
    can_suspend: boolean;
    can_reactivate: boolean;
  };
}

export interface LifecycleSummary {
  phone_unverified: number;
  pending_approval: number;
  active: number;
  rejected: number;
  suspended: number;
  locked: number;
}

export interface LifecycleState {
  ok: boolean;
  users: LifecycleUser[];
  pagination: {
    limit: number;
    offset: number;
    has_more: boolean;
    total_matches: number;
  };
  summary: LifecycleSummary;
}

export type LifecycleAction = 'APPROVE' | 'REJECT' | 'REOPEN' | 'SUSPEND' | 'REACTIVATE';

export interface LifecycleHistoryEntry {
  id: string;
  target_user_id: string;
  actor_user_id: string | null;
  old_status: string | null;
  new_status: string | null;
  old_is_active: boolean | null;
  new_is_active: boolean | null;
  old_version: number | null;
  new_version: number | null;
  action: string;
  change_reason: string | null;
  changed_at: string;
}

export const ACTION_LABELS: Record<LifecycleAction, string> = {
  APPROVE: 'تأیید',
  REJECT: 'رد',
  REOPEN: 'بازگشایی',
  SUSPEND: 'تعلیق',
  REACTIVATE: 'فعال‌سازی مجدد',
};

export const STATUS_LABELS: Record<string, string> = {
  PHONE_UNVERIFIED: 'تأیید نشده',
  PENDING_ADMIN_APPROVAL: 'در انتظار تأیید مدیر',
  ACTIVE: 'فعال',
  REJECTED: 'رد شده',
  SUSPENDED: 'معلق',
  LOCKED: 'قفل شده',
};

export const STATUS_COLORS: Record<string, string> = {
  PHONE_UNVERIFIED: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400',
  PENDING_ADMIN_APPROVAL: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  ACTIVE: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  REJECTED: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  SUSPENDED: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
  LOCKED: 'bg-red-200 text-red-800 dark:bg-red-900/50 dark:text-red-200',
};
