import type { ConferenceSupabaseClient } from '../../../components/VideoConference/conferenceClient';
import {
  CONFERENCE_PERMISSIONS,
  CONFERENCE_RBAC_ROLES,
  type ConferenceAuthorization,
  type ConferencePermission,
  type ConferenceRbacRole,
} from '../types/conference.types';

function isRbacRole(value: unknown): value is ConferenceRbacRole {
  return typeof value === 'string'
    && (CONFERENCE_RBAC_ROLES as readonly string[]).includes(value);
}

function isPermission(value: unknown): value is ConferencePermission {
  return typeof value === 'string'
    && (CONFERENCE_PERMISSIONS as readonly string[]).includes(value);
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object'
    ? value as Record<string, unknown>
    : null;
}

export async function getMyConferenceAuthorization(
  client: ConferenceSupabaseClient,
  roomId: string,
): Promise<ConferenceAuthorization> {
  const { data, error } = await client.rpc('get_my_conference_authorization', {
    p_room_id: roomId,
  });

  if (error) throw error;
  const payload = asObject(data);
  if (!payload || payload.ok !== true || !isRbacRole(payload.role)) {
    return { loaded: true, role: null, permissions: [] };
  }

  const rawPermissions = Array.isArray(payload.permissions) ? payload.permissions : [];
  return {
    loaded: true,
    role: payload.role,
    permissions: rawPermissions.filter(isPermission),
  };
}

export async function setConferenceParticipantRole(
  client: ConferenceSupabaseClient,
  roomId: string,
  userId: string,
  role: ConferenceRbacRole,
) {
  if (role === 'OWNER') throw new Error('OWNER_ROLE_IS_TRANSFER_ONLY');

  const { data, error } = await client.rpc('set_conference_participant_role', {
    p_room_id: roomId,
    p_target_user_id: userId,
    p_role: role,
  });
  if (error) throw error;

  const payload = asObject(data);
  if (!payload || payload.ok !== true) {
    throw new Error(String(payload?.reason || 'ROLE_CHANGE_FAILED'));
  }
  return payload;
}
