import type { OrgUserProfile, OrgUserAssignment } from '../../../lib/useOrgUsers';

export function normalizePersianTitle(value: string): string {
  return value
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/\u200c/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^رئیس/, 'رییس');
}

export function isAllowedMeetingRequestPosition(title: string | null): boolean {
  if (!title) return false;
  const normalized = normalizePersianTitle(title);
  return (
    normalized.startsWith('رییس دایره') ||
    normalized.startsWith('رییس دفتر') ||
    normalized.startsWith('متصدی اداری')
  );
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
