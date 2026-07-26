import { Mic } from 'lucide-react';

export function VoiceNoteFab({
  isRecording,
  onClick,
}: {
  isRecording: boolean;
  onClick: () => void;
}) {
  return (
    <div className="fixed bottom-6 left-6">
      <button
        onClick={onClick}
        className={`w-14 h-14 ${
          isRecording ? 'bg-red-500' : 'bg-blue-500'
        } rounded-full flex items-center justify-center shadow-lg hover:bg-blue-600 transition-colors`}
        title="یادداشت صوتی"
      >
        <Mic className="w-6 h-6 text-white" />
      </button>
    </div>
  );
}
