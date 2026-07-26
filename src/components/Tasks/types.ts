import { Task } from '../../types';

export interface UserProfile {
  user_id: string;
  full_name: string | null;
  email: string | null;
  avatar_url?: string | null;
  position?: string | null;
  unit_name?: string | null;
}

export interface TasksPageProps {
  prefillDescription?: string;
  prefillSourceMessageId?: string;
  onPrefillConsumed?: () => void;
  currentUserId?: string | null;
}

export type { Task };
