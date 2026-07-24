export { useAuthSession } from './hooks/useAuthSession';
export type { AuthSessionState } from './types/authSession';

export {
  getCurrentAuthUserId,
  signInWithPassword,
  signUpWithPassword,
  updateCurrentUserPassword,
  signOutCurrentUser,
} from './services/authOperations';

export type {
  PasswordAuthCredentials,
  SignUpWithPasswordInput,
} from './services/authOperations';
