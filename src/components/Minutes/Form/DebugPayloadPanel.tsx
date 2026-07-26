import type { MinutesDraftPayload } from './types';

export function DebugPayloadPanel({ payload }: { payload: MinutesDraftPayload }) {
  return (
    <div className="mt-6 rounded-2xl border border-dashed border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900/40 p-4" dir="ltr">
      <p className="text-xs font-semibold text-gray-400 mb-2">DEV — MinutesDraftPayload</p>
      <pre className="text-xs text-gray-600 dark:text-gray-300 overflow-x-auto max-h-80 overflow-y-auto">
        {JSON.stringify(payload, null, 2)}
      </pre>
    </div>
  );
}
