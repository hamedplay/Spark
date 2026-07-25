export { useAuthSession } from './hooks/useAuthSession';
export type { AuthSessionState } from './types/authSession';

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
