import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
} from 'react';

import {
  DEFAULT_USER_PREFERENCES,
  type UserPreferences,
  type UserPreferencesPatch,
} from '../types/userPreferences';
import {
  mapUserPreferencesRow,
  mergeUserPreferences,
} from '../mappers/mapUserPreferencesRow';
import {
  fetchUserPreferencesRow,
  upsertUserPreferences,
} from '../repositories/userPreferencesRepository';
import {
  startUserPreferencesLifecycle,
} from '../services/userPreferencesLifecycle';
import {
  getCurrentAuthUserId,
  subscribeToAuthUserIdChanges,
} from '../../auth';

export interface UserPreferencesContextValue {
  prefs: UserPreferences;
  loading: boolean;

  updatePrefs:
    (
      patch:
        UserPreferencesPatch
    ) => Promise<void>;
}

const UserPreferencesContext =
  createContext<
    UserPreferencesContextValue
  >({
    prefs:
      DEFAULT_USER_PREFERENCES,

    loading: true,

    updatePrefs:
      async () => {},
  });

export function UserPreferencesProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [prefs, setPrefs] =
    useState<UserPreferences>(
      DEFAULT_USER_PREFERENCES
    );

  const [loading, setLoading] =
    useState(true);

  const [userId, setUserId] =
    useState<string | null>(null);

  useEffect(() => {
    const cleanup =
      startUserPreferencesLifecycle({
        getCurrentUserId:
          getCurrentAuthUserId,
        subscribeToAuthUserIdChanges,
        loadPreferences: async (
          nextUserId
        ) => {
          const row =
            await fetchUserPreferencesRow(
              nextUserId
            );

          return row
            ? mapUserPreferencesRow(row)
            : null;
        },
        onUserIdChange: (nextUserId) => {
          setUserId(nextUserId);
        },
        onPreferencesLoaded: (loaded) => {
          setPrefs(loaded);
          localStorage.setItem(
            'theme',
            loaded.theme
          );
          localStorage.setItem(
            'accent_color',
            loaded.accent_color
          );
        },
        onSignedOut: () => {
          setPrefs(
            DEFAULT_USER_PREFERENCES
          );
        },
        onLoadingComplete: () => {
          setLoading(false);
        },
      });

    return cleanup;
  }, []);

  const updatePrefs = useCallback(
    async (
      patch:
        UserPreferencesPatch
    ) => {
      const next =
        mergeUserPreferences(
          prefs,
          patch
        );

      setPrefs(next);

      if (!userId) {
        return;
      }

      await upsertUserPreferences(
        userId,
        next,
        new Date().toISOString()
      );
    },
    [
      prefs,
      userId,
    ]
  );

  return (
    <UserPreferencesContext.Provider
      value={{
        prefs,
        loading,
        updatePrefs,
      }}
    >
      {children}
    </UserPreferencesContext.Provider>
  );
}

export function useUserPreferences():
  UserPreferencesContextValue {
  return useContext(
    UserPreferencesContext
  );
}
