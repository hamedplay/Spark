import type { InvitationStatus } from '../components/Minutes/types';

/**
 * Valid invitation_status values accepted by the database CHECK constraint
 * on minutes_participants and minutes_external_participants:
 *   invited | accepted | declined | no_response | delegated
 *
 * The frontend also uses 'pending' (from meeting_inbox mapping), which the
 * database does NOT accept. This helper normalizes any frontend value to a
 * DB-safe one so create/update RPCs never receive an invalid status.
 */
const DB_VALID: ReadonlySet<InvitationStatus> = new Set([
  'invited',
  'accepted',
  'declined',
  'no_response',
  'delegated',
]);

/**
 * Normalize a frontend invitation status to a value the database accepts.
 * 'pending' (در انتظار پاسخ) maps to 'no_response' (بدون پاسخ) since the DB
 * has no 'pending' value. Unknown/null/empty values fall back to 'invited',
 * which is the column default.
 */
export function normalizeInvitationStatus(
  status: string | null | undefined,
): InvitationStatus {
  if (!status) return 'invited';
  const s = status as InvitationStatus;
  if (DB_VALID.has(s)) return s;
  if (s === 'pending') return 'no_response';
  return 'invited';
}

/**
 * Normalize an array of participants (internal or external) in-place by
 * returning a new array with invitation_status mapped through
 * normalizeInvitationStatus. Works for both DraftInternalParticipant and
 * DraftExternalParticipant shapes since both expose `invitationStatus`.
 */
export function normalizeParticipantsInvitationStatus<
  T extends { invitationStatus: InvitationStatus },
>(participants: T[]): T[] {
  return participants.map(p => ({
    ...p,
    invitationStatus: normalizeInvitationStatus(p.invitationStatus),
  }));
}
