/** One best-effort request per observed FULL session; the database also deduplicates across tabs/reloads. */
export function createSessionContextRecorder(write: () => PromiseLike<{ error: unknown; data?: unknown }>) {
  let recorded: string | null = null;
  let pending: string | null = null;
  return async (state: { access_level: string; session_id: string | null; user_id: string | null }) => {
    if (state.access_level !== 'FULL' || !state.session_id || !state.user_id) return;
    const key = `${state.user_id}:${state.session_id}`;
    if (key === recorded || key === pending) return;
    pending = key;
    try {
      const { error, data } = await write();
      if (!error && data !== false) recorded = key;
    } catch { /* Evidence persistence must not change an authorization decision. */ }
    finally { if (pending === key) pending = null; }
  };
}
