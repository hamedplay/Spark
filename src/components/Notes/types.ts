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
