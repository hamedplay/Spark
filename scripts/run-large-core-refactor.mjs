import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const sourcePath = 'scripts/refactor-large-core-files.mjs';
const runtimePath = 'scripts/.refactor-large-core-runtime.mjs';
let source = fs.readFileSync(sourcePath, 'utf8');

const calendarBefore = `  extractBlock({ file, functionName:'CalendarPage', startMarker:'  // ---- Fetch ----', endMarker:"  // Current user's personal public calendar", helperFile:'src/components/Calendar/useCalendarDataActions.ts', helperName:'useCalendarDataActions' });\n  extractView({ file, functionName:'CalendarPage', helperFile:'src/components/Calendar/CalendarPageView.tsx', helperName:'CalendarPageView' });`;
const calendarAfter = `  extractBlock({ file, functionName:'CalendarPage', startMarker:'  // ---- Fetch ----', endMarker:"  // Current user's personal public calendar", helperFile:'src/components/Calendar/useCalendarDataActions.ts', helperName:'useCalendarDataActions' });\n  extractBlock({ file, functionName:'CalendarPage', startMarker:'  // ---- Navigation ----', endMarker:'  // ---- Drag/grid helpers ----', helperFile:'src/components/Calendar/useCalendarNavigation.ts', helperName:'useCalendarNavigation' });\n  extractView({ file, functionName:'CalendarPage', helperFile:'src/components/Calendar/CalendarPageView.tsx', helperName:'CalendarPageView' });`;
if (!source.includes(calendarBefore)) throw new Error('Calendar refactor insertion point not found');
source = source.replace(calendarBefore, calendarAfter);

const e2eeBefore = `  extractBlock({ file, functionName:'useE2EECall', startMarker:'  // ── Offer / Session channel', endMarker:'  // ── Call flow', helperFile:'src/components/Chat/E2EECall/useE2EESessionChannel.ts', helperName:'useE2EESessionChannel' });`;
const e2eeAfter = `  extractBlock({ file, functionName:'useE2EECall', startMarker:'  // ── Cleanup', endMarker:'  // ── Push keys to all active port records', helperFile:'src/components/Chat/E2EECall/useE2EELifecycleHelpers.ts', helperName:'useE2EELifecycleHelpers' });\n  extractBlock({ file, functionName:'useE2EECall', startMarker:'  // ── Offer / Session channel', endMarker:'  // ── Call flow', helperFile:'src/components/Chat/E2EECall/useE2EESessionChannel.ts', helperName:'useE2EESessionChannel' });`;
if (!source.includes(e2eeBefore)) throw new Error('E2EE lifecycle insertion point not found');
source = source.replace(e2eeBefore, e2eeAfter);

fs.writeFileSync(runtimePath, source);
try {
  await import(pathToFileURL(runtimePath).href + `?run=${Date.now()}`);
} finally {
  fs.rmSync(runtimePath, { force: true });
}
