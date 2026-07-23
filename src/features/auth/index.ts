export { useAuthSession } from './hooks/useAuthSession';
export type { AuthSessionState } from './types/authSession';

export {
  getCurrentAuthUserId,
  signInWithPassword,
  signUpWithPassword,
} from './services/authOperations';

export type {
  PasswordAuthCredentials,
  SignUpWithPasswordInput,
} from './services/authOperations';
