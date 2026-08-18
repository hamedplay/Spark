import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const sourcePath = 'scripts/refactor-large-core-files.mjs';
const runtimePath = 'scripts/.refactor-large-core-runtime.mjs';
let source = fs.readFileSync(sourcePath, 'utf8');

const before = `  extractBlock({ file, functionName:'CalendarPage', startMarker:'  // ---- Fetch ----', endMarker:"  // Current user's personal public calendar", helperFile:'src/components/Calendar/useCalendarDataActions.ts', helperName:'useCalendarDataActions' });\n  extractView({ file, functionName:'CalendarPage', helperFile:'src/components/Calendar/CalendarPageView.tsx', helperName:'CalendarPageView' });`;

const after = `  extractBlock({ file, functionName:'CalendarPage', startMarker:'  // ---- Fetch ----', endMarker:"  // Current user's personal public calendar", helperFile:'src/components/Calendar/useCalendarDataActions.ts', helperName:'useCalendarDataActions' });\n  extractBlock({ file, functionName:'CalendarPage', startMarker:'  // ---- Navigation ----', endMarker:'  // ---- Drag/grid helpers ----', helperFile:'src/components/Calendar/useCalendarNavigation.ts', helperName:'useCalendarNavigation' });\n  extractView({ file, functionName:'CalendarPage', helperFile:'src/components/Calendar/CalendarPageView.tsx', helperName:'CalendarPageView' });`;

if (!source.includes(before)) {
  throw new Error('Calendar refactor insertion point not found');
}
source = source.replace(before, after);
fs.writeFileSync(runtimePath, source);
try {
  await import(pathToFileURL(runtimePath).href + `?run=${Date.now()}`);
} finally {
  fs.rmSync(runtimePath, { force: true });
}
