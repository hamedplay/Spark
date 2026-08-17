import { GoogleOAuthProvider } from '@react-oauth/google';
import AuthenticatedApp from './AuthenticatedApp';

const GOOGLE_CLIENT_ID = '41324082012-hkaifd58rm2b1tujs2jsbd7c4hug2lds.apps.googleusercontent.com';

export default function AuthenticatedRoot() {
  return (
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
      <AuthenticatedApp />
    </GoogleOAuthProvider>
  );
}
