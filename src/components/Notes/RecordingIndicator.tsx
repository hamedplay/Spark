import { Mic } from 'lucide-react';

export function RecordingIndicator({ voiceTranscript, onStop }: { voiceTranscript: string; onStop: () => void }) {
  return (
    <div className="fixed inset-x-0 top-20 mx-auto max-w-lg bg-white dark:bg-gray-800 p-4 rounded-lg shadow-lg z-50">
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <p className="text-gray-600 dark:text-gray-300 mb-2">در حال ضبط...</p>
          <p className="text-gray-800 dark:text-white">{voiceTranscript}</p>
        </div>
        <button
          onClick={onStop}
          className="mr-4 p-2 bg-red-500 text-white rounded-full animate-pulse"
        >
          <Mic className="w-6 h-6" />
        </button>
      </div>
    </div>
  );
}
