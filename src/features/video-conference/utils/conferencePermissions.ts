import type {
  ConferenceAuthorization,
  ConferencePermission,
  ConferenceRbacRole,
} from '../types/conference.types';

export const ASSIGNABLE_CONFERENCE_ROLES: ConferenceRbacRole[] = [
  'HOST',
  'CO_HOST',
  'MODERATOR',
  'PRESENTER',
  'PARTICIPANT',
  'VIEWER',
];

const ROLE_LABELS: Record<ConferenceRbacRole, string> = {
  OWNER: 'مالک جلسه',
  HOST: 'میزبان',
  CO_HOST: 'هم‌میزبان',
  MODERATOR: 'مدیر جلسه',
  PRESENTER: 'ارائه‌دهنده',
  PARTICIPANT: 'شرکت‌کننده',
  VIEWER: 'بیننده',
};

export function hasConferencePermission(
  authorization: ConferenceAuthorization,
  permission: ConferencePermission,
): boolean {
  return authorization.loaded && authorization.permissions.includes(permission);
}

export function conferenceRoleLabel(role: ConferenceRbacRole): string {
  return ROLE_LABELS[role];
}

export function conferenceMessageRole(role: ConferenceRbacRole | null): 'admin' | 'moderator' | 'user' {
  if (role === 'OWNER' || role === 'HOST' || role === 'CO_HOST') return 'admin';
  if (role === 'MODERATOR') return 'moderator';
  return 'user';
}
