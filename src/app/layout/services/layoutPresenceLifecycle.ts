import type {
  UpsertLayoutPresenceInput,
} from '../repositories/layoutUserRepository';

import type {
  LayoutUserStatus,
} from '../types/layoutUser';

export interface LayoutPresenceLifecycleEnvironment {
  setInterval(
    callback: () => void,
    intervalMs: number
  ): number;

  clearInterval(
    intervalId: number
  ): void;

  addBeforeUnload(
    listener: () => void
  ): void;

  removeBeforeUnload(
    listener: () => void
  ): void;
}

export interface StartLayoutPresenceLifecycleInput {
  userId: string;

  readStatus:
    () => LayoutUserStatus;

  now:
    () => string;

  upsertPresence:
    (
      input: UpsertLayoutPresenceInput
    ) => Promise<void>;

  markOffline:
    (userId: string) =>
      Promise<void>;

  environment:
    LayoutPresenceLifecycleEnvironment;
}

export async function startLayoutPresenceLifecycle(
  input: StartLayoutPresenceLifecycleInput
): Promise<() => void> {
  const initialStatus =
    input.readStatus();

  await input.upsertPresence({
    userId: input.userId,
    status: initialStatus,
    isOnline: true,
    lastSeen: input.now(),
  });

  const heartbeat = () => {
    const s = input.readStatus();
    if (s === 'offline') return;
    void input.upsertPresence({
      userId: input.userId,
      status: s,
      isOnline: true,
      lastSeen: input.now(),
    });
  };

  const intervalId =
    input.environment.setInterval(
      heartbeat,
      60_000
    );

  const beforeUnloadListener = () => {
    void input.markOffline(
      input.userId
    );
  };

  input.environment.addBeforeUnload(
    beforeUnloadListener
  );

  return () => {
    input.environment.clearInterval(
      intervalId
    );
    input.environment.removeBeforeUnload(
      beforeUnloadListener
    );
  };
}
