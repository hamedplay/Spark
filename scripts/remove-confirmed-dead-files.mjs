// one-time execution trigger
import fs from 'node:fs';
import childProcess from 'node:child_process';

const candidates = [
  'src/app/hooks/useMaintenanceMode.ts',
  'src/app/hooks/useSparkVisibility.ts',
  'src/components/Minutes/Form/JalaliDateField.tsx',
  'src/components/PortalConfig/AuditLists.tsx',
  'src/components/PortalConfig/BaleOtpConfigCard.tsx',
  'src/components/PortalConfig/PhoneSyncCard.tsx',
  'src/components/TelegramWebhookSetup.tsx',
  'src/components/ThemeToggle.tsx',
  'src/components/VideoConference/Room/SidePanelHeader.tsx',
  'src/features/auth/services/recoveryService.ts',
  'src/features/meetings/components/MeetingCard/MeetingEditForm.tsx',
  'src/shared/repositories/publicProfileRepository.ts',
];

const ignoredEvidence = new Set([
  'scripts/.dead-code-audit.json',
  'scripts/.jscpd-audit.json',
  'scripts/.knip-audit.json',
  'scripts/.knip-audit.stderr.txt',
  'scripts/.jscpd-audit.stderr.txt',
  'scripts/.dead-code-tool-status.txt',
  'scripts/remove-confirmed-dead-files.mjs',
]);

const tracked = childProcess.execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);

for (const file of candidates) {
  if (!fs.existsSync(file)) throw new Error(`candidate missing before cleanup: ${file}`);
  const base = file.split('/').pop().replace(/\.(tsx?|jsx?)$/, '');
  const relNoExt = file.replace(/\.(tsx?|jsx?)$/, '');
  const references = [];
  for (const other of tracked) {
    if (other === file || ignoredEvidence.has(other) || !fs.existsSync(other)) continue;
    let text;
    try { text = fs.readFileSync(other, 'utf8'); } catch { continue; }
    if (text.includes(file) || text.includes(relNoExt) || text.includes(base)) references.push(other);
  }
  if (references.length) {
    throw new Error(`refusing to delete ${file}; references found in: ${references.join(', ')}`);
  }
}

for (const file of candidates) fs.unlinkSync(file);
console.log(`removed=${candidates.length}`);
for (const file of candidates) console.log(file);
