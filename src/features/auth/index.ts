export { useAuthSession } from './hooks/useAuthSession';
export type { AuthSessionState, AuthAccessState, AccessLevel, ReasonCode, NextStep } from './types/authSession';

export {
  getCurrentAuthUserId,
  signInWithPassword,
  updateCurrentUserPassword,
  signOutCurrentUser,
  subscribeToAuthUserIdChanges,
} from './services/authOperations';

export type {
  PasswordAuthCredentials,
  AuthUserIdChangeListener,
} from './services/authOperations';

export {
  listCurrentUserTotpFactors,
  startTotpEnrollment,
  verifyTotpFactor,
  cancelCurrentTotpEnrollment,
  unenrollTotpFactor,
  performTotpStepUp,
  getCurrentAal,
  validateTotpCode,
} from './services/mfaOperations';

export type {
  TotpFactor,
  TotpEnrollmentResult,
  StepUpGrantResult,
  StepUpPurpose,
  PerformTotpStepUpParams,
  MfaEnrollError,
  VerifyResult,
} from './services/mfaOperations';

export { TotpEnrollmentGate } from './components/TotpEnrollmentGate';
export { TotpChallengeGate } from './components/TotpChallengeGate';
