import { UserCheck } from 'lucide-react';

export function MeetingManagerSection(props: {
  selectedParticipants: { id: string; name: string }[];
  meetingManager: string;
  setMeetingManager: React.Dispatch<React.SetStateAction<string>>;
  participantDisplayItems: { id: string; name: string }[];
  managerDisplayName: string;
}) {
  const { selectedParticipants, meetingManager, setMeetingManager, participantDisplayItems, managerDisplayName } = props;
  if (selectedParticipants.length === 0) return null;
  return (
    <div>
      <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
        <UserCheck className="w-4 h-4" />مدیر جلسه
      </label>
      <select value={meetingManager} onChange={e => setMeetingManager(e.target.value)}
        className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white">
        <option value="">بدون مدیر</option>
        {participantDisplayItems.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      {meetingManager && managerDisplayName && (
        <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">{managerDisplayName}</div>
      )}
    </div>
  );
}
