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
