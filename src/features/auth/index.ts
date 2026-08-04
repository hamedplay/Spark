export { useAuthSession } from './hooks/useAuthSession';
export type { AuthSessionState, AuthAccessState, AccessLevel, ReasonCode, NextStep } from './types/authSession';

export {
  getCurrentAuthUserId,
  signInWithPassword,
  signUpWithPassword,
  updateCurrentUserPassword,
  signOutCurrentUser,
  subscribeToAuthUserIdChanges,
} from './services/authOperations';

export type {
  PasswordAuthCredentials,
  SignUpWithPasswordInput,
  AuthUserIdChangeListener,
} from './services/authOperations';

export {
  listCurrentUserTotpFactors,
  startTotpEnrollment,
  verifyTotpFactor,
  cancelCurrentTotpEnrollment,
  performTotpStepUp,
  validateTotpCode,
} from './services/mfaOperations';

export type {
  TotpFactor,
  TotpEnrollmentResult,
  StepUpGrantResult,
  StepUpPurpose,
  PerformTotpStepUpParams,
} from './services/mfaOperations';

export { TotpEnrollmentGate } from './components/TotpEnrollmentGate';
export { TotpChallengeGate } from './components/TotpChallengeGate';
