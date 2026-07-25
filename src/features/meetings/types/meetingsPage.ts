import { Meeting } from '../../../types';
import { SparkMeetingPrefill } from '../../../components/Spark/SparkAssistant';

type MeetingsPageId = 'meetings' | 'create-meeting' | 'calendar';

export interface MeetingsPageProps {
  meetings: Meeting[];
  pendingMeetingsCount: number;
  fetchMeetings: () => Promise<void>;
  fetchPendingMeetingsCount: () => Promise<void>;
  searchTerm: string;
  setSearchTerm: (v: string) => void;
  statusFilter: 'all' | 'open' | 'archived';
  setStatusFilter: (v: 'all' | 'open' | 'archived') => void;
  priorityFilter: 'all' | 'high' | 'medium' | 'low';
  setPriorityFilter: (v: 'all' | 'high' | 'medium' | 'low') => void;
  showPendingMeetingsModal: boolean;
  setShowPendingMeetingsModal: (v: boolean) => void;
  setActivePage: (page: MeetingsPageId) => void;
  setPendingSchedule: (v: { meetingId: string; meeting: Meeting } | null) => void;
  isAdmin: boolean;
  userPermissions: Record<string, boolean> | null | undefined;
}

export interface CreateMeetingPageProps {
  prefillData: SparkMeetingPrefill | null;
  setActivePage: (page: MeetingsPageId) => void;
  setSparkMeetingPrefill: (v: SparkMeetingPrefill | null) => void;
  fetchMeetings: () => Promise<void>;
}
