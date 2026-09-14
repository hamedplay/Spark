import { readFileSync, writeFileSync } from 'node:fs';

const path = 'src/components/ProfilePage.tsx';
let text = readFileSync(path, 'utf8');

const replaceOnce = (from, to, label) => {
  if (!text.includes(from)) throw new Error(`Missing anchor: ${label}`);
  text = text.replace(from, to);
};

replaceOnce(
  "import { TotpFactorManager } from '../features/auth/components/TotpFactorManager';\nimport { SessionManagementPanel } from '../features/auth/components/SessionManagementPanel';",
  "import { TotpFactorManager } from '../features/auth/components/TotpFactorManager';\nimport { MfaMethodSelector } from '../features/auth/components/MfaMethodSelector';\nimport { SessionManagementPanel } from '../features/auth/components/SessionManagementPanel';",
  'auth component imports',
);

replaceOnce(
  "  const [openSection, setOpenSection] = useState<'personal' | 'work' | 'social' | 'calendar' | 'security'>('personal');\n  const [saved, setSaved] = useState(false);",
  "  const [openSection, setOpenSection] = useState<'personal' | 'work' | 'social' | 'calendar' | 'security'>('personal');\n  const [mfaMethodRefreshKey, setMfaMethodRefreshKey] = useState(0);\n  const [saved, setSaved] = useState(false);",
  'profile state',
);

replaceOnce(
  "  useEffect(() => {\n    return () => { stopAvatarPoll(); };\n  }, []);",
  "  useEffect(() => {\n    return () => { stopAvatarPoll(); };\n  }, []);\n\n  useEffect(() => {\n    const handleMfaMethodChanged = () => setMfaMethodRefreshKey((value) => value + 1);\n    window.addEventListener('spark:mfa-method-changed', handleMfaMethodChanged);\n    return () => window.removeEventListener('spark:mfa-method-changed', handleMfaMethodChanged);\n  }, []);",
  'profile effects',
);

replaceOnce(
  `      {/* Security / TOTP — outside profile form to prevent submit on Enter */}\n      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden mt-4">\n        <SectionHeader id="security" title="امنیت حساب" subtitle="مدیریت احراز هویت دومرحله‌ای (TOTP)" />\n        {openSection === 'security' && (\n          <div className="p-6 space-y-6">\n            <TotpFactorManager />\n            <div className="border-t border-gray-100 dark:border-gray-700 pt-6">\n              <SessionManagementPanel />\n            </div>\n          </div>\n        )}\n      </div>`,
  `      {/* Security / MFA — outside profile form to prevent submit on Enter */}\n      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden mt-4">\n        <SectionHeader id="security" title="امنیت حساب" subtitle="انتخاب و مدیریت روش احراز هویت دومرحله‌ای" />\n        {openSection === 'security' && (\n          <div className="p-6 space-y-6">\n            <MfaMethodSelector\n              refreshKey={mfaMethodRefreshKey}\n              onRequestTotpEnrollment={() => {\n                document.getElementById('totp-factor-manager')?.scrollIntoView({ behavior: 'smooth', block: 'center' });\n              }}\n              onCanonicalStateChanged={() => setMfaMethodRefreshKey((value) => value + 1)}\n            />\n            <div id="totp-factor-manager" className="border-t border-gray-100 dark:border-gray-700 pt-6">\n              <TotpFactorManager />\n            </div>\n            <div className="border-t border-gray-100 dark:border-gray-700 pt-6">\n              <SessionManagementPanel />\n            </div>\n          </div>\n        )}\n      </div>`,
  'security section',
);

writeFileSync(path, text);

// Triggered only for the temporary validation workflow.
