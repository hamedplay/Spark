import { useEffect, useState } from 'react';

import { getCurrentAuthUserId } from '../../../features/auth';
import {
  fetchLayoutUserProfile,
  upsertLayoutUserPresence,
  markLayoutUserOffline,
} from '../repositories/layoutUserRepository';
import {
  startLayoutPresenceLifecycle,
} from '../services/layoutPresenceLifecycle';
import type {
  LayoutUserStatus,
  LayoutUserProfile,
} from '../types/layoutUser';

export function useLayoutUserPresence():
  LayoutUserProfile | null {
  const [userProfile, setUserProfile] =
    useState<LayoutUserProfile | null>(
      null
    );

  useEffect(() => {
    let disposed = false;
    let lifecycleCleanup:
      | (() => void)
      | undefined;

    (async () => {
      const userId =
        await getCurrentAuthUserId();
      if (!userId) return;
      if (disposed) return;

      const profile =
        await fetchLayoutUserProfile(
          userId
        );
      if (!disposed && profile) {
        setUserProfile(profile);
      }

      const readStatus = () =>
        (
          localStorage.getItem(
            'user_status'
          ) as LayoutUserStatus
        ) || 'online';

      lifecycleCleanup =
        await startLayoutPresenceLifecycle(
          {
            userId,
            readStatus,
            now: () =>
              new Date().toISOString(),
            upsertPresence:
              upsertLayoutUserPresence,
            markOffline:
              markLayoutUserOffline,
            environment: {
              setInterval:
                window.setInterval.bind(
                  window
                ),
              clearInterval:
                window.clearInterval.bind(
                  window
                ),
              addBeforeUnload:
                (listener) =>
                  window.addEventListener(
                    'beforeunload',
                    listener
                  ),
              removeBeforeUnload:
                (listener) =>
                  window.removeEventListener(
                    'beforeunload',
                    listener
                  ),
            },
          }
        );

      if (disposed && lifecycleCleanup) {
        lifecycleCleanup();
        lifecycleCleanup = undefined;
      }
    })();

    return () => {
      disposed = true;
      if (lifecycleCleanup) {
        lifecycleCleanup();
        lifecycleCleanup = undefined;
      }
    };
  }, []);

  return userProfile;
}
