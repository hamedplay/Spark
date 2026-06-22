import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleOAuthProvider } from '@react-oauth/google';
import App from './App.tsx';
import './index.css';
import { ThemeProvider } from './context/ThemeContext';

const GOOGLE_CLIENT_ID = "41324082012-hkaifd58rm2b1tujs2jsbd7c4hug2lds.apps.googleusercontent.com";

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
        <App />
      </GoogleOAuthProvider>
    </ThemeProvider>
  </StrictMode>
);