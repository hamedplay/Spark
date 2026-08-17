import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import './responsive.css';
import './management-dashboard-theme.css';
import './notes-theme.css';
import './spark-loader.css';
import './corporate-theme.css';
import './auth-reference-login.css';
import './auth-reference-login-fixes.css';
import './auth-login-unified-tabs.css';
import './auth-login-theme-guard.css';
import './auth-login-performance.css';
import './auth-login-unified-tabs.ts';

// Apply the persisted/system theme before React mounts so the branded loading
// screen never flashes in the wrong color scheme while ThemeProvider is lazy-loaded.
try {
  const savedTheme = localStorage.getItem('theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const shouldUseDark = savedTheme === 'dark' || (!savedTheme && prefersDark);
  document.documentElement.classList.toggle('dark', shouldUseDark);
} catch {
  // Storage can be unavailable in hardened/private browser contexts. In that
  // case the application safely falls back to the light loader until mounted.
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
