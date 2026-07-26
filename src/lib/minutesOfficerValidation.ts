/**
 * Pure mirror of the server-side secretary/chair validation in
 * `create_minutes_draft` and `update_minutes_draft`.
 *
 * The RPCs reject an officer when their user_id is non-null and either:
 *   - the user does not exist in `public.profiles`, or
 *   - the user does not belong to the meeting (checked via
 *     `_minutes_user_belongs_to_meeting`, which inspects
 *     `meetings.user_id`, `meetings.meeting_manager`, and
 *     `meetings.participant_user_ids`).
 *
 * A null officer id is allowed (matches existing RPC behavior). The same
 * user may be both secretary and chair.
 */

export type OfficerRole = 'secretary' | 'chair';

export type OfficerValidationResult =
  | { valid: true }
  | { valid: false; errorCode: string };

const ERROR_CODE: Record<OfficerRole, { notFound: string; notParticipant: string }> = {
  secretary: {
    notFound: 'SECRETARY_USER_NOT_FOUND',
    notParticipant: 'SECRETARY_NOT_MEETING_PARTICIPANT',
  },
  chair: {
    notFound: 'CHAIR_USER_NOT_FOUND',
    notParticipant: 'CHAIR_NOT_MEETING_PARTICIPANT',
  },
};

export interface MeetingMembership {
  meetingOwnerId: string | null;
  meetingManagerId: string | null;
  participantUserIds: string[] | null;
}

function userBelongsToMeeting(userId: string, membership: MeetingMembership): boolean {
  if (membership.meetingOwnerId === userId) return true;
  if (membership.meetingManagerId === userId) return true;
  if (membership.participantUserIds && membership.participantUserIds.includes(userId)) return true;
  return false;
}

export function validateOfficer(
  role: OfficerRole,
  officerUserId: string | null,
  knownUserIds: Set<string>,
  membership: MeetingMembership,
): OfficerValidationResult {
  if (!officerUserId) return { valid: true };
  if (!knownUserIds.has(officerUserId)) {
    return { valid: false, errorCode: ERROR_CODE[role].notFound };
  }
  if (!userBelongsToMeeting(officerUserId, membership)) {
    return { valid: false, errorCode: ERROR_CODE[role].notParticipant };
  }
  return { valid: true };
}

export function validateSecretaryAndChair(
  secretaryUserId: string | null,
  chairUserId: string | null,
  knownUserIds: Set<string>,
  membership: MeetingMembership,
): { secretary: OfficerValidationResult; chair: OfficerValidationResult } {
  return {
    secretary: validateOfficer('secretary', secretaryUserId, knownUserIds, membership),
    chair: validateOfficer('chair', chairUserId, knownUserIds, membership),
  };
}
