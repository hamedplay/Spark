import type { ConferenceSupabaseClient } from '../../../components/VideoConference/conferenceClient';
import type {
  ConferenceWhiteboardOperation,
  ConferenceWhiteboardSnapshot,
} from '../types/conference.types';

export const CONFERENCE_WHITEBOARD_ASSET_BUCKET = 'conference-whiteboard-assets';

export class ConferenceWhiteboardActionError extends Error {
  code: string;
  persisted: boolean;
  operation: ConferenceWhiteboardOperation | null;

  constructor(
    code: string,
    persisted = false,
    operation: ConferenceWhiteboardOperation | null = null,
  ) {
    super(code);
    this.name = 'ConferenceWhiteboardActionError';
    this.code = code;
    this.persisted = persisted;
    this.operation = operation;
  }
}

export async function loadConferenceWhiteboardSnapshot(
  client: ConferenceSupabaseClient,
  roomId: string,
): Promise<ConferenceWhiteboardSnapshot> {
  const { data, error } = await client.rpc(
    'get_conference_whiteboard_snapshot_v2',
    { p_room_id: roomId },
  );

  if (error) throw error;
  if (!data?.ok) {
    throw new ConferenceWhiteboardActionError(
      String(data?.reason || 'WHITEBOARD_LOAD_FAILED').toUpperCase(),
    );
  }

  return {
    loaded: true,
    roomStatus: String(data.roomStatus || ''),
    boardLocked: Boolean(data.boardLocked),
    boardRevision: Number(data.boardRevision || 0),
    canUse: Boolean(data.canUse),
    canManage: Boolean(data.canManage),
    pages: Array.isArray(data.pages) ? data.pages : [],
    serverTime: String(data.serverTime || new Date().toISOString()),
  };
}

export async function runConferenceWhiteboardAction(
  client: ConferenceSupabaseClient,
  input: {
    roomId: string;
    action: ConferenceWhiteboardOperation['action'];
    pageId?: string;
    payload?: Record<string, unknown>;
  },
): Promise<ConferenceWhiteboardOperation | null> {
  const { data, error } = await client.functions.invoke(
    'conference-whiteboard-control',
    { body: input },
  );

  if (error || !data?.ok) {
    throw new ConferenceWhiteboardActionError(
      String(data?.error || error?.message || 'WHITEBOARD_ACTION_FAILED'),
      Boolean(data?.persisted),
      data?.operation || null,
    );
  }

  return data.operation || null;
}

function whiteboardImageExtension(file: File): string {
  if (file.type === 'image/png') return 'png';
  if (file.type === 'image/webp') return 'webp';
  if (file.type === 'image/gif') return 'gif';
  return 'jpg';
}

export async function uploadConferenceWhiteboardImage(
  client: ConferenceSupabaseClient,
  roomId: string,
  pageId: string,
  userId: string,
  file: File,
): Promise<string> {
  const allowed = new Set([
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
  ]);
  if (!allowed.has(file.type)) throw new Error('WHITEBOARD_IMAGE_TYPE_INVALID');
  if (file.size <= 0 || file.size > 5 * 1024 * 1024) {
    throw new Error('WHITEBOARD_IMAGE_SIZE_INVALID');
  }

  const path = [
    roomId,
    pageId,
    userId,
    `${crypto.randomUUID()}.${whiteboardImageExtension(file)}`,
  ].join('/');

  const { error } = await client.storage
    .from(CONFERENCE_WHITEBOARD_ASSET_BUCKET)
    .upload(path, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type,
    });

  if (error) throw error;
  return path;
}

export async function createSignedConferenceWhiteboardAssetUrl(
  client: ConferenceSupabaseClient,
  path: string,
): Promise<string> {
  const { data, error } = await client.storage
    .from(CONFERENCE_WHITEBOARD_ASSET_BUCKET)
    .createSignedUrl(path, 24 * 60 * 60);

  if (error || !data?.signedUrl) throw error || new Error('WHITEBOARD_ASSET_URL_FAILED');
  return data.signedUrl;
}
