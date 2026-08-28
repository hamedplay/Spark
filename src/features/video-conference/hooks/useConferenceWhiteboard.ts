import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RoomEvent, type Room } from 'livekit-client';
import type { ConferenceSupabaseClient } from '../../../components/VideoConference/conferenceClient';
import {
  ConferenceWhiteboardActionError,
  createSignedConferenceWhiteboardAssetUrl,
  loadConferenceWhiteboardSnapshot,
  runConferenceWhiteboardAction,
  uploadConferenceWhiteboardImage,
} from '../services/conferenceWhiteboard';
import type {
  ConferenceAuthorization,
  ConferenceWhiteboardElement,
  ConferenceWhiteboardOperation,
  ConferenceWhiteboardPoint,
  ConferenceWhiteboardPresence,
  ConferenceWhiteboardSnapshot,
} from '../types/conference.types';
import {
  applyConferenceWhiteboardOperation,
  conferenceWhiteboardAssetPaths,
  findConferenceWhiteboardElement,
} from '../utils/conferenceWhiteboardState';
import { hasConferencePermission } from '../utils/conferencePermissions';

const EMPTY_SNAPSHOT: ConferenceWhiteboardSnapshot = {
  loaded: false,
  roomStatus: '',
  boardLocked: false,
  boardRevision: 0,
  canUse: false,
  canManage: false,
  pages: [],
  serverTime: '',
};

type ElementMutation = {
  action: 'upsert_element' | 'delete_element';
  pageId: string;
  payload: Record<string, unknown>;
};

type HistoryEntry = {
  undo: ElementMutation;
  redo: ElementMutation;
};

interface Params {
  client: ConferenceSupabaseClient;
  room: Room;
  roomId: string;
  currentUserId: string;
  currentUserName: string;
  authorization: ConferenceAuthorization;
}

function whiteboardErrorLabel(error: unknown): string {
  if (error instanceof ConferenceWhiteboardActionError) {
    if (error.code === 'BOARD_LOCKED') return 'تخته توسط مدیر جلسه قفل شده است.';
    if (error.code === 'FORBIDDEN') return 'اجازه ویرایش تخته را ندارید.';
    if (error.code === 'PAGE_LIMIT_REACHED') return 'حداکثر ۲۰ صفحه مجاز است.';
    if (error.code === 'LAST_PAGE_REQUIRED') return 'حداقل یک صفحه باید باقی بماند.';
    if (error.code === 'SNAPSHOT_TOO_LARGE') return 'حجم تخته از حد مجاز بیشتر شده است.';
    if (error.code === 'WHITEBOARD_BROADCAST_FAILED' && error.persisted) {
      return 'تغییر ذخیره شد؛ همگام‌سازی زنده دوباره بازیابی می‌شود.';
    }
  }
  return 'عملیات تخته سفید انجام نشد.';
}

export function useConferenceWhiteboard({
  client,
  room,
  roomId,
  currentUserId,
  currentUserName,
  authorization,
}: Params) {
  const [snapshot, setSnapshot] = useState<ConferenceWhiteboardSnapshot>(EMPTY_SNAPSHOT);
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [presence, setPresence] = useState<Record<string, ConferenceWhiteboardPresence>>({});
  const [assetUrls, setAssetUrls] = useState<Record<string, string>>({});
  const [undoStack, setUndoStack] = useState<HistoryEntry[]>([]);
  const [redoStack, setRedoStack] = useState<HistoryEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const seenOperationsRef = useRef(new Set<string>());
  const refreshTimerRef = useRef<number | null>(null);
  const lastPresenceSentRef = useRef(0);

  const permissionCanUse = hasConferencePermission(authorization, 'USE_WHITEBOARD');
  const permissionCanManage = hasConferencePermission(authorization, 'MANAGE_WHITEBOARD');

  const refreshSnapshot = useCallback(async () => {
    try {
      const next = await loadConferenceWhiteboardSnapshot(client, roomId);
      setSnapshot(next);
      setSelectedPageId((current) => {
        if (current && next.pages.some((page) => page.id === current)) {
          return current;
        }
        return next.pages[0]?.id || null;
      });
    } catch (error) {
      console.error('[VideoConference] whiteboard snapshot load failed', error);
      setErrorMessage('بازیابی تخته سفید انجام نشد.');
    }
  }, [client, roomId]);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimerRef.current !== null) window.clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = window.setTimeout(() => {
      refreshTimerRef.current = null;
      void refreshSnapshot();
    }, 250);
  }, [refreshSnapshot]);

  const applyOperation = useCallback((operation: ConferenceWhiteboardOperation) => {
    if (seenOperationsRef.current.has(operation.id)) return;
    seenOperationsRef.current.add(operation.id);
    if (seenOperationsRef.current.size > 500) {
      const recent = [...seenOperationsRef.current].slice(-250);
      seenOperationsRef.current = new Set(recent);
    }

    setSnapshot((current) => applyConferenceWhiteboardOperation(current, operation));
    if (operation.action === 'delete_page' && operation.pageId) {
      setSelectedPageId((current) => current === operation.pageId ? null : current);
    }
    if (operation.action === 'add_page' && operation.pageId) {
      setSelectedPageId(operation.pageId);
    }
  }, []);

  useEffect(() => {
    void refreshSnapshot();

    const decoder = new TextDecoder();
    const onData = (
      payload: Uint8Array,
      participant: { identity: string; name?: string } | undefined,
      _kind: unknown,
      topic?: string,
    ) => {
      if (topic === 'spark-whiteboard-op') {
        if (participant) return;
        try {
          const operation = JSON.parse(decoder.decode(payload)) as ConferenceWhiteboardOperation;
          if (
            !operation
            || typeof operation.id !== 'string'
            || typeof operation.action !== 'string'
            || operation.roomId !== roomId
          ) return;
          applyOperation(operation);
        } catch {
          // Malformed server packets are ignored.
        }
        return;
      }

      if (topic !== 'spark-whiteboard-presence' || !participant) return;
      try {
        const value = JSON.parse(decoder.decode(payload)) as {
          pageId?: string;
          x?: number;
          y?: number;
          laser?: boolean;
          timestamp?: number;
        };
        if (
          typeof value.pageId !== 'string'
          || typeof value.x !== 'number'
          || typeof value.y !== 'number'
          || !Number.isFinite(value.x)
          || !Number.isFinite(value.y)
          || Math.abs(value.x) > 1_000_000
          || Math.abs(value.y) > 1_000_000
        ) return;

        setPresence((current) => ({
          ...current,
          [participant.identity]: {
            participantIdentity: participant.identity,
            displayName: participant.name || participant.identity,
            pageId: value.pageId,
            x: value.x,
            y: value.y,
            laser: Boolean(value.laser),
            timestamp: Date.now(),
          },
        }));
      } catch {
        // Malformed transient presence is ignored.
      }
    };

    const onReconnected = () => void refreshSnapshot();
    room.on(RoomEvent.DataReceived, onData);
    room.on(RoomEvent.Reconnected, onReconnected);

    const channel = client
      .channel(`conference-whiteboard-v2-${roomId}-${currentUserId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'conference_whiteboard_pages',
        filter: `room_id=eq.${roomId}`,
      }, scheduleRefresh)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'conference_whiteboard_boards',
        filter: `room_id=eq.${roomId}`,
      }, scheduleRefresh)
      .subscribe();

    const presenceTimer = window.setInterval(() => {
      const cutoff = Date.now() - 1500;
      setPresence((current) => {
        const next: Record<string, ConferenceWhiteboardPresence> = {};
        let changed = false;
        for (const [identity, item] of Object.entries(current)) {
          if (item.timestamp >= cutoff) next[identity] = item;
          else changed = true;
        }
        return changed ? next : current;
      });
    }, 500);

    return () => {
      room.off(RoomEvent.DataReceived, onData);
      room.off(RoomEvent.Reconnected, onReconnected);
      void client.removeChannel(channel);
      window.clearInterval(presenceTimer);
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
      }
    };
  }, [
    applyOperation,
    client,
    currentUserId,
    refreshSnapshot,
    room,
    roomId,
    scheduleRefresh,
  ]);

  useEffect(() => {
    let cancelled = false;
    const paths = conferenceWhiteboardAssetPaths(snapshot)
      .filter((path) => !assetUrls[path]);

    if (paths.length === 0) return undefined;

    void Promise.all(paths.map(async (path) => {
      try {
        const url = await createSignedConferenceWhiteboardAssetUrl(client, path);
        return [path, url] as const;
      } catch (error) {
        console.error('[VideoConference] whiteboard asset URL failed', error);
        return null;
      }
    })).then((results) => {
      if (cancelled) return;
      setAssetUrls((current) => {
        const next = { ...current };
        for (const item of results) {
          if (item) next[item[0]] = item[1];
        }
        return next;
      });
    });

    return () => { cancelled = true; };
  }, [assetUrls, client, snapshot]);

  const runMutation = useCallback(async (
    mutation: ElementMutation | {
      action: ConferenceWhiteboardOperation['action'];
      pageId?: string;
      payload?: Record<string, unknown>;
    },
  ) => {
    setBusy(true);
    setErrorMessage('');
    try {
      const operation = await runConferenceWhiteboardAction(client, {
        roomId,
        action: mutation.action,
        pageId: mutation.pageId,
        payload: mutation.payload,
      });
      if (operation) applyOperation(operation);
      return operation;
    } catch (error) {
      console.error('[VideoConference] whiteboard mutation failed', error);
      if (
        error instanceof ConferenceWhiteboardActionError
        && error.persisted
      ) {
        if (error.operation) applyOperation(error.operation);
        scheduleRefresh();
      }
      setErrorMessage(whiteboardErrorLabel(error));
      throw error;
    } finally {
      setBusy(false);
    }
  }, [applyOperation, client, roomId, scheduleRefresh]);

  const pushHistory = useCallback((entry: HistoryEntry) => {
    setUndoStack((current) => [...current, entry].slice(-100));
    setRedoStack([]);
  }, []);

  const upsertElement = useCallback(async (
    pageId: string,
    element: ConferenceWhiteboardElement,
    recordHistory = true,
  ) => {
    const previous = findConferenceWhiteboardElement(
      snapshotRef.current,
      pageId,
      element.id,
    );
    await runMutation({
      action: 'upsert_element',
      pageId,
      payload: { element },
    });

    if (recordHistory) {
      pushHistory({
        undo: previous
          ? { action: 'upsert_element', pageId, payload: { element: previous } }
          : { action: 'delete_element', pageId, payload: { elementId: element.id } },
        redo: { action: 'upsert_element', pageId, payload: { element } },
      });
    }
  }, [pushHistory, runMutation]);

  const deleteElement = useCallback(async (
    pageId: string,
    element: ConferenceWhiteboardElement,
    recordHistory = true,
  ) => {
    await runMutation({
      action: 'delete_element',
      pageId,
      payload: { elementId: element.id },
    });
    if (recordHistory) {
      pushHistory({
        undo: { action: 'upsert_element', pageId, payload: { element } },
        redo: { action: 'delete_element', pageId, payload: { elementId: element.id } },
      });
    }
  }, [pushHistory, runMutation]);

  const undo = useCallback(async () => {
    const entry = undoStack[undoStack.length - 1];
    if (!entry || busy) return;
    setUndoStack((current) => current.slice(0, -1));
    try {
      await runMutation(entry.undo);
      setRedoStack((current) => [...current, entry].slice(-100));
    } catch {
      setUndoStack((current) => [...current, entry]);
    }
  }, [busy, runMutation, undoStack]);

  const redo = useCallback(async () => {
    const entry = redoStack[redoStack.length - 1];
    if (!entry || busy) return;
    setRedoStack((current) => current.slice(0, -1));
    try {
      await runMutation(entry.redo);
      setUndoStack((current) => [...current, entry].slice(-100));
    } catch {
      setRedoStack((current) => [...current, entry]);
    }
  }, [busy, redoStack, runMutation]);

  const publishPresence = useCallback((
    pageId: string,
    point: ConferenceWhiteboardPoint,
    laser: boolean,
  ) => {
    const now = Date.now();
    if (now - lastPresenceSentRef.current < 50) return;
    lastPresenceSentRef.current = now;

    const payload = new TextEncoder().encode(JSON.stringify({
      pageId,
      x: point.x,
      y: point.y,
      laser,
      displayName: currentUserName,
      timestamp: now,
    }));

    void room.localParticipant.publishData(payload, {
      reliable: false,
      topic: 'spark-whiteboard-presence',
    }).catch((error) => {
      console.debug('[VideoConference] whiteboard presence send skipped', error);
    });
  }, [currentUserName, room]);

  const uploadImage = useCallback(async (
    pageId: string,
    file: File,
    points: [ConferenceWhiteboardPoint, ConferenceWhiteboardPoint],
  ) => {
    const path = await uploadConferenceWhiteboardImage(
      client,
      roomId,
      pageId,
      currentUserId,
      file,
    );
    const element: ConferenceWhiteboardElement = {
      id: crypto.randomUUID(),
      type: 'image',
      points,
      color: '#111827',
      width: 1,
      assetPath: path,
    };
    await upsertElement(pageId, element);
  }, [client, currentUserId, roomId, upsertElement]);

  const currentPage = useMemo(
    () => snapshot.pages.find((page) => page.id === selectedPageId)
      || snapshot.pages[0]
      || null,
    [selectedPageId, snapshot.pages],
  );

  const visiblePresence = useMemo(
    () => Object.values(presence).filter(
      (item) => item.pageId === currentPage?.id,
    ),
    [currentPage?.id, presence],
  );

  const canUse = snapshot.loaded
    ? snapshot.canUse
    : permissionCanUse;
  const canManage = snapshot.loaded
    ? snapshot.canManage
    : permissionCanManage;
  const canEdit = canUse && (!snapshot.boardLocked || canManage);

  return {
    snapshot,
    currentPage,
    selectedPageId: currentPage?.id || null,
    presence: visiblePresence,
    assetUrls,
    canUse,
    canManage,
    canEdit,
    busy,
    errorMessage,
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
    selectPage: setSelectedPageId,
    refreshSnapshot,
    upsertElement,
    deleteElement,
    undo,
    redo,
    publishPresence,
    uploadImage,
    addPage: (title?: string) => runMutation({
      action: 'add_page',
      payload: { title },
    }),
    deletePage: (pageId: string) => runMutation({
      action: 'delete_page',
      pageId,
    }),
    renamePage: (pageId: string, title: string) => runMutation({
      action: 'rename_page',
      pageId,
      payload: { title },
    }),
    clearPage: (pageId: string) => runMutation({
      action: 'clear_page',
      pageId,
    }),
    toggleLock: () => runMutation({
      action: snapshot.boardLocked ? 'unlock' : 'lock',
    }),
  };
}
