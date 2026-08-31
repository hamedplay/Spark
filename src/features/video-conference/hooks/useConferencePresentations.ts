import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RoomEvent, type Room } from 'livekit-client';
import type { ConferenceSupabaseClient } from '../../../components/VideoConference/conferenceClient';
import {
  ConferencePresentationActionError,
  createSignedConferencePresentationUrl,
  loadConferencePresentationAnnotation,
  loadConferencePresentationSnapshot,
  runConferencePresentationAction,
  uploadConferencePresentation,
} from '../services/conferencePresentations';
import type {
  ConferenceAuthorization,
  ConferencePresentationAnnotationElement,
  ConferencePresentationAnnotationSnapshot,
  ConferencePresentationLaser,
  ConferencePresentationSnapshot,
} from '../types/conference.types';

const EMPTY_SNAPSHOT: ConferencePresentationSnapshot = {
  loaded: false,
  serverTime: '',
  canUpload: false,
  canManage: false,
  canAnnotate: false,
  annotatorUserIds: [],
  state: {
    presentationId: null,
    presenterUserId: null,
    currentPage: 1,
    isActive: false,
    revision: 0,
    activatedAt: null,
    updatedAt: null,
  },
  presentations: [],
};

const EMPTY_ANNOTATION: ConferencePresentationAnnotationSnapshot = {
  loaded: false,
  canAnnotate: false,
  revision: 0,
  elements: [],
  updatedAt: null,
};

interface Params {
  client: ConferenceSupabaseClient;
  room: Room;
  roomId: string;
  currentUserId: string;
  currentUserName: string;
  authorization: ConferenceAuthorization;
}

function errorLabel(error: unknown): string {
  const code = error instanceof ConferencePresentationActionError ? error.code : '';
  if (code === 'FORBIDDEN' || code === 'NOT_AUTHORIZED') return 'دسترسی لازم برای این عملیات را ندارید.';
  if (code === 'UNSUPPORTED_FILE_TYPE') return 'نوع فایل برای ارائه پشتیبانی نمی‌شود.';
  if (code === 'INVALID_FILE_SIZE') return 'حجم فایل باید حداکثر ۵۰ مگابایت باشد.';
  if (code === 'CONVERTER_NOT_CONFIGURED') return 'مبدل اسناد Office روی سرور پیکربندی نشده است.';
  if (code === 'CONVERSION_FAILED') return 'تبدیل فایل به PDF ناموفق بود.';
  if (code === 'PRESENTATION_NOT_READY') return 'فایل هنوز برای ارائه آماده نیست.';
  return 'عملیات ارائه انجام نشد.';
}

export function useConferencePresentations({
  client,
  room,
  roomId,
  currentUserId,
  currentUserName,
  authorization,
}: Params) {
  const [snapshot, setSnapshot] = useState<ConferencePresentationSnapshot>(EMPTY_SNAPSHOT);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [annotation, setAnnotation] = useState<ConferencePresentationAnnotationSnapshot>(EMPTY_ANNOTATION);
  const [assetUrls, setAssetUrls] = useState<Record<string, string>>({});
  const [lasers, setLasers] = useState<Record<string, ConferencePresentationLaser>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const refreshTimerRef = useRef<number | null>(null);
  const lastLaserRef = useRef(0);

  const canUse = authorization.loaded && authorization.role !== null;

  const refresh = useCallback(async () => {
    if (!canUse) {
      setSnapshot({ ...EMPTY_SNAPSHOT, loaded: true });
      return;
    }

    try {
      const next = await loadConferencePresentationSnapshot(client, roomId);
      setSnapshot(next);
      setSelectedId((current) => {
        if (next.state.isActive && next.state.presentationId) return next.state.presentationId;
        if (current && next.presentations.some((item) => item.id === current)) return current;
        return next.presentations.find((item) => item.status === 'READY')?.id
          || next.presentations[0]?.id
          || null;
      });
      setErrorMessage('');
    } catch (error) {
      console.error('[VideoConference] presentation snapshot failed', error);
      setErrorMessage(errorLabel(error));
    }
  }, [canUse, client, roomId]);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimerRef.current !== null) window.clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = window.setTimeout(() => {
      refreshTimerRef.current = null;
      void refresh();
    }, 200);
  }, [refresh]);

  useEffect(() => {
    void refresh();
    if (!canUse) return undefined;

    const channel = client
      .channel(`conference-presentations-${roomId}-${currentUserId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'conference_presentations',
        filter: `room_id=eq.${roomId}`,
      }, scheduleRefresh)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'conference_presentation_state',
        filter: `room_id=eq.${roomId}`,
      }, scheduleRefresh)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'conference_presentation_annotations',
        filter: `room_id=eq.${roomId}`,
      }, scheduleRefresh)
      .subscribe();

    return () => {
      void client.removeChannel(channel);
      if (refreshTimerRef.current !== null) window.clearTimeout(refreshTimerRef.current);
    };
  }, [canUse, client, currentUserId, refresh, roomId, scheduleRefresh]);

  const selected = useMemo(
    () => snapshot.presentations.find((item) => item.id === selectedId) || null,
    [selectedId, snapshot.presentations],
  );

  const activeSelected = Boolean(
    selected
    && snapshot.state.isActive
    && snapshot.state.presentationId === selected.id,
  );

  const page = activeSelected ? snapshot.state.currentPage : 1;

  useEffect(() => {
    if (!selected?.renderedPath || selected.status !== 'READY' || assetUrls[selected.id]) {
      return undefined;
    }

    let cancelled = false;
    void createSignedConferencePresentationUrl(client, selected.renderedPath)
      .then((url) => {
        if (!cancelled) {
          setAssetUrls((current) => ({ ...current, [selected.id]: url }));
        }
      })
      .catch((error) => {
        console.error('[VideoConference] presentation signed URL failed', error);
        if (!cancelled) setErrorMessage('دریافت فایل ارائه ناموفق بود.');
      });

    return () => {
      cancelled = true;
    };
  }, [assetUrls, client, selected]);

  const refreshAnnotation = useCallback(async () => {
    if (!selected || selected.status !== 'READY') {
      setAnnotation(EMPTY_ANNOTATION);
      return;
    }

    try {
      setAnnotation(await loadConferencePresentationAnnotation(
        client,
        roomId,
        selected.id,
        page,
      ));
    } catch (error) {
      console.error('[VideoConference] presentation annotation load failed', error);
      setAnnotation(EMPTY_ANNOTATION);
    }
  }, [client, page, roomId, selected]);

  useEffect(() => {
    void refreshAnnotation();
  }, [refreshAnnotation, snapshot.state.revision]);

  useEffect(() => {
    const decoder = new TextDecoder();

    const onData = (
      payload: Uint8Array,
      participant: { identity: string; name?: string } | undefined,
      _kind: unknown,
      topic?: string,
    ) => {
      if (topic !== 'spark-presentation-laser' || !participant) return;

      try {
        const value = JSON.parse(decoder.decode(payload)) as {
          presentationId?: string;
          page?: number;
          x?: number;
          y?: number;
        };

        if (
          typeof value.presentationId !== 'string'
          || typeof value.page !== 'number'
          || typeof value.x !== 'number'
          || typeof value.y !== 'number'
          || value.x < 0
          || value.x > 1000
          || value.y < 0
          || value.y > 1000
        ) return;

        setLasers((current) => ({
          ...current,
          [participant.identity]: {
            participantIdentity: participant.identity,
            displayName: participant.name || participant.identity,
            presentationId: value.presentationId as string,
            page: value.page as number,
            x: value.x as number,
            y: value.y as number,
            timestamp: Date.now(),
          },
        }));
      } catch {
        // Malformed transient packets are ignored.
      }
    };

    const onReconnected = () => void refresh();
    room.on(RoomEvent.DataReceived, onData);
    room.on(RoomEvent.Reconnected, onReconnected);

    const timer = window.setInterval(() => {
      const cutoff = Date.now() - 1200;
      setLasers((current) => {
        const next: Record<string, ConferencePresentationLaser> = {};
        let changed = false;
        for (const [identity, item] of Object.entries(current)) {
          if (item.timestamp >= cutoff) next[identity] = item;
          else changed = true;
        }
        return changed ? next : current;
      });
    }, 400);

    return () => {
      room.off(RoomEvent.DataReceived, onData);
      room.off(RoomEvent.Reconnected, onReconnected);
      window.clearInterval(timer);
    };
  }, [refresh, room]);

  const run = useCallback(async (
    key: string,
    operation: () => Promise<unknown>,
  ) => {
    if (busy) return false;

    setBusy(key);
    setErrorMessage('');
    try {
      await operation();
      await refresh();
      return true;
    } catch (error) {
      console.error('[VideoConference] presentation action failed', error);
      setErrorMessage(errorLabel(error));
      return false;
    } finally {
      setBusy(null);
    }
  }, [busy, refresh]);

  const action = useCallback((
    actionName: string,
    presentationId: string,
    payload?: Record<string, unknown>,
  ) => run(
    `${actionName}:${presentationId}`,
    () => runConferencePresentationAction(client, {
      roomId,
      action: actionName,
      presentationId,
      payload,
    }),
  ), [client, roomId, run]);

  const navigate = useCallback(async (nextPage: number) => {
    if (!selected || !activeSelected || !snapshot.canManage) return false;
    const maxPage = selected.pageCount || 1000;
    return action('navigate', selected.id, {
      page: Math.max(1, Math.min(maxPage, Math.floor(nextPage))),
    });
  }, [action, activeSelected, selected, snapshot.canManage]);

  const upsertAnnotation = useCallback(async (
    element: ConferencePresentationAnnotationElement,
  ) => {
    if (!selected || !snapshot.canAnnotate) return false;
    const ok = await action('annotation_upsert', selected.id, { page, element });
    if (ok) await refreshAnnotation();
    return ok;
  }, [action, page, refreshAnnotation, selected, snapshot.canAnnotate]);

  const clearAnnotation = useCallback(async () => {
    if (!selected || !snapshot.canManage) return false;
    const ok = await action('annotation_clear', selected.id, { page });
    if (ok) await refreshAnnotation();
    return ok;
  }, [action, page, refreshAnnotation, selected, snapshot.canManage]);

  const publishLaser = useCallback((x: number, y: number) => {
    if (!selected || !snapshot.canAnnotate) return;

    const now = Date.now();
    if (now - lastLaserRef.current < 50) return;
    lastLaserRef.current = now;

    const payload = new TextEncoder().encode(JSON.stringify({
      presentationId: selected.id,
      page,
      x,
      y,
      displayName: currentUserName,
      timestamp: now,
    }));

    void room.localParticipant.publishData(payload, {
      reliable: false,
      topic: 'spark-presentation-laser',
    }).catch((error) => {
      console.debug('[VideoConference] presentation laser skipped', error);
    });
  }, [currentUserName, page, room, selected, snapshot.canAnnotate]);

  const visibleLasers = useMemo(
    () => Object.values(lasers).filter(
      (laser) => laser.presentationId === selected?.id && laser.page === page,
    ),
    [lasers, page, selected?.id],
  );

  return {
    ...snapshot,
    canUse,
    selected,
    selectedId,
    activeSelected,
    page,
    assetUrl: selected ? assetUrls[selected.id] || null : null,
    annotation,
    lasers: visibleLasers,
    busy,
    errorMessage,
    selectPresentation: setSelectedId,
    refresh,
    upload: (file: File) => run(
      'upload',
      () => uploadConferencePresentation(client, roomId, file),
    ),
    activate: (id: string) => action('activate', id),
    deactivate: (id: string) => action('deactivate', id),
    deletePresentation: (id: string) => action('delete', id),
    retryConversion: (id: string) => action('retry_conversion', id),
    navigate,
    upsertAnnotation,
    clearAnnotation,
    publishLaser,
  };
}
