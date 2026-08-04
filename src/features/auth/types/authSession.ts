export type AccessLevel = 'FULL' | 'RESTRICTED' | 'BLOCKED';

export type ReasonCode =
  | 'AUTHORIZED'
  | 'SESSION_REQUIRED'
  | 'SESSION_INVALID'
  | 'SESSION_EXPIRED'
  | 'ACCESS_CHECK_FAILED'
  | 'PROFILE_MISSING'
  | 'ACCOUNT_STATUS_INVALID'
  | 'ACCOUNT_REJECTED'
  | 'ACCOUNT_SUSPENDED'
  | 'ACCOUNT_LOCKED'
  | 'PHONE_VERIFICATION_REQUIRED'
  | 'ADMIN_APPROVAL_REQUIRED'
  | 'PROFILE_COMPLETION_REQUIRED'
  | 'MFA_ENROLLMENT_REQUIRED'
  | 'MFA_CHALLENGE_REQUIRED';

export type NextStep =
  | 'login'
  | 'verify_phone'
  | 'wait_approval'
  | 'complete_profile'
  | 'enroll_mfa'
  | 'verify_mfa'
  | null;

export interface AuthAccessState {
  has_session: boolean;
  access_level: AccessLevel;
  reason_code: ReasonCode;
  next_step: NextStep;
  user_id: string | null;
  session_id: string | null;
  account_status: string | null;
  profile_completion_status: string | null;
  mfa_required: boolean;
  has_verified_totp: boolean;
  current_aal: string | null;
}

export interface AuthSessionState {
  loading: boolean;
  hasSession: boolean;
  isFullyAuthorized: boolean;
  isAuthenticated: boolean;
  accessLevel: AccessLevel | null;
  reasonCode: ReasonCode | null;
  nextStep: NextStep;
  currentUserId: string | null;
  sessionId: string | null;
  accountStatus: string | null;
  profileCompletionStatus: string | null;
  mfaRequired: boolean;
  hasVerifiedTotp: boolean;
  currentAal: string | null;
  isAdmin: boolean;
  userPermissions: Record<string, boolean> | null | undefined;
  refreshAccessState: () => Promise<void>;
}
