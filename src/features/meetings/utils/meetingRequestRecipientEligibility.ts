import type { OrgUserProfile, OrgUserAssignment } from '../../../lib/useOrgUsers';

const ALLOWED_PREFIXES = [
  'رییس دایره',
  'مدیر امور',
  'متصدی اداری',
];

export function normalizePersianTitle(value: string): string {
  return value
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/\u200c/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isAllowedMeetingRequestPosition(title: string | null): boolean {
  if (!title) return false;
  const normalized = normalizePersianTitle(title);
  return ALLOWED_PREFIXES.some(prefix => normalized.startsWith(prefix));
}

export function isMeetingRequestRecipientEligible(profile: OrgUserProfile): boolean {
  if (!profile.assignments || profile.assignments.length === 0) return false;
  return profile.assignments.some((assignment: OrgUserAssignment) =>
    isAllowedMeetingRequestPosition(assignment.positionTitle),
  );
}

export function filterMeetingRequestRecipients(users: OrgUserProfile[]): OrgUserProfile[] {
  return users.filter(isMeetingRequestRecipientEligible);
}
