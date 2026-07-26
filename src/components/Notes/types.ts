export interface Note {
  id: string;
  title: string;
  content: string;
  drawing_data?: string | null;
  note_type: 'text' | 'voice';
  created_at: string;
  user_id: string;
  status: 'active' | 'archived';
  file_url?: string;
  file_type?: string;
  file_name?: string;
  file_size?: number;
}

export type NoteStatusFilter = 'all' | 'active' | 'archived';

export const NOTE_COLORS = [
  { bg: 'bg-yellow-50 dark:bg-yellow-900/20', border: 'border-yellow-200 dark:border-yellow-700/50', header: 'bg-yellow-100/60 dark:bg-yellow-800/30' },
  { bg: 'bg-blue-50 dark:bg-blue-900/20', border: 'border-blue-200 dark:border-blue-700/50', header: 'bg-blue-100/60 dark:bg-blue-800/30' },
  { bg: 'bg-green-50 dark:bg-green-900/20', border: 'border-green-200 dark:border-green-700/50', header: 'bg-green-100/60 dark:bg-green-800/30' },
  { bg: 'bg-pink-50 dark:bg-pink-900/20', border: 'border-pink-200 dark:border-pink-700/50', header: 'bg-pink-100/60 dark:bg-pink-800/30' },
  { bg: 'bg-purple-50 dark:bg-purple-900/20', border: 'border-purple-200 dark:border-purple-700/50', header: 'bg-purple-100/60 dark:bg-purple-800/30' },
  { bg: 'bg-orange-50 dark:bg-orange-900/20', border: 'border-orange-200 dark:border-orange-700/50', header: 'bg-orange-100/60 dark:bg-orange-800/30' },
];
