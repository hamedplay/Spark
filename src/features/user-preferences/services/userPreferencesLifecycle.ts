import type {
  UserPreferences,
} from '../types/userPreferences';

export interface StartUserPreferencesLifecycleInput {
  getCurrentUserId:
    () => Promise<string | null>;

  subscribeToAuthUserIdChanges:
    (
      listener:
        (
          userId: string | null
        ) => void
    ) => () => void;

  loadPreferences:
    (
      userId: string
    ) =>
      Promise<UserPreferences | null>;

  onUserIdChange:
    (
      userId: string | null
    ) => void;

  onPreferencesLoaded:
    (
      preferences: UserPreferences
    ) => void;

  onSignedOut:
    () => void;

  onLoadingComplete:
    () => void;
}

export function startUserPreferencesLifecycle(
  input: StartUserPreferencesLifecycleInput
): () => void {
  let disposed = false;
  let generation = 0;

  const unsubscribe =
    input.subscribeToAuthUserIdChanges(
      (userId) => {
        if (disposed) return;
        const gen = ++generation;

        if (userId === null) {
          input.onUserIdChange(null);
          input.onSignedOut();
          input.onLoadingComplete();
          return;
        }

        input.onUserIdChange(userId);

        void (async () => {
          const loaded =
            await input.loadPreferences(
              userId
            );

          if (disposed) return;
          if (gen !== generation) return;

          if (loaded) {
            input.onPreferencesLoaded(
              loaded
            );
          }
          input.onLoadingComplete();
        })();
      }
    );

  const initialGen = generation;

  void (async () => {
    const userId =
      await input.getCurrentUserId();

    if (disposed) return;
    if (initialGen !== generation) return;

    if (userId === null) {
      input.onLoadingComplete();
      return;
    }

    input.onUserIdChange(userId);

    const loaded =
      await input.loadPreferences(userId);

    if (disposed) return;
    if (initialGen !== generation) return;

    if (loaded) {
      input.onPreferencesLoaded(loaded);
    }
    input.onLoadingComplete();
  })();

  return () => {
    disposed = true;
    generation++;
    unsubscribe();
  };
}
