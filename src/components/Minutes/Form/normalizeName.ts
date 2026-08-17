/**
 * Normalize a person name for duplicate comparison.
 * Trims leading/trailing whitespace, collapses repeated spaces, and
 * normalizes Arabic/Yeh and Arabic/Kaf to Persian equivalents.
 */
export function normalizeName(name: string): string {
  return (name || '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\u064A/g, '\u06CC') // Arabic Yeh → Persian Yeh
    .replace(/\u0643/g, '\u06A9') // Arabic Kaf → Persian Kaf
    .toLowerCase();
}
