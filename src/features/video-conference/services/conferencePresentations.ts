import type { ConferenceSupabaseClient } from '../../../components/VideoConference/conferenceClient';
import type {
  ConferencePresentationAnnotationSnapshot,
  ConferencePresentationItem,
  ConferencePresentationSnapshot,
  ConferencePresentationSourceKind,
} from '../types/conference.types';

export const CONFERENCE_PRESENTATION_BUCKET = 'conference-presentations';
export const CONFERENCE_PRESENTATION_MAX_BYTES = 50 * 1024 * 1024;

const MIME_TO_KIND: Record<string, ConferencePresentationSourceKind> = {
  'application/pdf': 'PDF',
  'image/jpeg': 'IMAGE',
  'image/png': 'IMAGE',
  'image/webp': 'IMAGE',
  'image/gif': 'IMAGE',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'SLIDES',
  'application/vnd.ms-powerpoint': 'SLIDES',
  'application/vnd.oasis.opendocument.presentation': 'SLIDES',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCUMENT',
  'application/msword': 'DOCUMENT',
  'application/vnd.oasis.opendocument.text': 'DOCUMENT',
};

export class ConferencePresentationActionError extends Error {
  code: string;

  constructor(code: string) {
    super(code);
    this.name = 'ConferencePresentationActionError';
    this.code = code;
  }
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object'
    ? value as Record<string, unknown>
    : null;
}

export function presentationSourceKind(file: File): ConferencePresentationSourceKind | null {
  return MIME_TO_KIND[file.type.toLowerCase()] || null;
}

export async function loadConferencePresentationSnapshot(
  client: ConferenceSupabaseClient,
  roomId: string,
): Promise<ConferencePresentationSnapshot> {
  const { data, error } = await client.rpc('get_conference_presentation_snapshot', {
    p_room_id: roomId,
  });
  if (error) throw error;

  const payload = asObject(data);
  if (!payload || payload.ok !== true) {
    throw new ConferencePresentationActionError(
      String(payload?.reason || 'PRESENTATION_LOAD_FAILED').toUpperCase(),
    );
  }

  const state = asObject(payload.state);
  return {
    loaded: true,
    serverTime: typeof payload.serverTime === 'string'
      ? payload.serverTime
      : new Date().toISOString(),
    canUpload: payload.canUpload === true,
    canManage: payload.canManage === true,
    canAnnotate: payload.canAnnotate === true,
    annotatorUserIds: Array.isArray(payload.annotatorUserIds)
      ? payload.annotatorUserIds.filter((value): value is string => typeof value === 'string')
      : [],
    state: {
      presentationId: typeof state?.presentationId === 'string' ? state.presentationId : null,
      presenterUserId: typeof state?.presenterUserId === 'string' ? state.presenterUserId : null,
      currentPage: Math.max(1, Number(state?.currentPage || 1)),
      isActive: state?.isActive === true,
      revision: Number(state?.revision || 0),
      activatedAt: typeof state?.activatedAt === 'string' ? state.activatedAt : null,
      updatedAt: typeof state?.updatedAt === 'string' ? state.updatedAt : null,
    },
    presentations: Array.isArray(payload.presentations)
      ? payload.presentations as ConferencePresentationItem[]
      : [],
  };
}

export async function loadConferencePresentationAnnotation(
  client: ConferenceSupabaseClient,
  roomId: string,
  presentationId: string,
  page: number,
): Promise<ConferencePresentationAnnotationSnapshot> {
  const { data, error } = await client.rpc(
    'get_conference_presentation_annotation_snapshot',
    {
      p_room_id: roomId,
      p_presentation_id: presentationId,
      p_page_number: page,
    },
  );
  if (error) throw error;

  const payload = asObject(data);
  if (!payload || payload.ok !== true) {
    throw new ConferencePresentationActionError(
      String(payload?.reason || 'ANNOTATION_LOAD_FAILED').toUpperCase(),
    );
  }

  const snapshot = asObject(payload.snapshot);
  return {
    loaded: true,
    canAnnotate: payload.canAnnotate === true,
    revision: Number(payload.revision || 0),
    elements: Array.isArray(snapshot?.elements)
      ? snapshot.elements as ConferencePresentationAnnotationSnapshot['elements']
      : [],
    updatedAt: typeof payload.updatedAt === 'string' ? payload.updatedAt : null,
  };
}

export async function runConferencePresentationAction(
  client: ConferenceSupabaseClient,
  input: {
    roomId: string;
    action: string;
    presentationId?: string;
    payload?: Record<string, unknown>;
  },
) {
  const { data, error } = await client.functions.invoke(
    'conference-presentation-control',
    { body: input },
  );

  if (error || !data?.ok) {
    throw new ConferencePresentationActionError(
      String(data?.error || error?.message || 'PRESENTATION_ACTION_FAILED').toUpperCase(),
    );
  }

  return data as Record<string, unknown>;
}

export async function uploadConferencePresentation(
  client: ConferenceSupabaseClient,
  roomId: string,
  file: File,
) {
  if (!presentationSourceKind(file)) {
    throw new ConferencePresentationActionError('UNSUPPORTED_FILE_TYPE');
  }
  if (file.size <= 0 || file.size > CONFERENCE_PRESENTATION_MAX_BYTES) {
    throw new ConferencePresentationActionError('INVALID_FILE_SIZE');
  }

  const created = await runConferencePresentationAction(client, {
    roomId,
    action: 'create',
    payload: {
      title: file.name.replace(/\.[^.]+$/, '').trim() || file.name,
      originalFileName: file.name,
      sourceMimeType: file.type,
      fileSizeBytes: file.size,
    },
  });

  const presentationId = String(created.presentation_id || '');
  const sourcePath = String(created.source_path || '');
  if (!presentationId || !sourcePath) {
    throw new ConferencePresentationActionError('PRESENTATION_CREATE_INVALID');
  }

  try {
    const { error } = await client.storage
      .from(CONFERENCE_PRESENTATION_BUCKET)
      .upload(sourcePath, file, {
        upsert: false,
        cacheControl: '3600',
        contentType: file.type,
      });
    if (error) throw error;

    return await runConferencePresentationAction(client, {
      roomId,
      action: 'finalize',
      presentationId,
    });
  } catch (error) {
    try {
      await runConferencePresentationAction(client, {
        roomId,
        action: 'delete',
        presentationId,
      });
    } catch {
      // Failed cleanup leaves metadata non-READY, so it cannot be activated.
    }
    throw error;
  }
}

export async function createSignedConferencePresentationUrl(
  client: ConferenceSupabaseClient,
  path: string,
): Promise<string> {
  const { data, error } = await client.storage
    .from(CONFERENCE_PRESENTATION_BUCKET)
    .createSignedUrl(path, 60 * 60);

  if (error || !data?.signedUrl) {
    throw error || new Error('PRESENTATION_SIGNED_URL_FAILED');
  }
  return data.signedUrl;
}
