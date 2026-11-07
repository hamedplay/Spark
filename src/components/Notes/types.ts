export interface Note {
  id: string;
  creator_id?: string | null;
  creator_name?: string | null;
  reminder_creator_id?: string | null;
  reminder_creator_name?: string | null;
  sms_include_content?: boolean;
  title: string;
  content: string;
  drawing_data?: string | null;
  note_type: 'text' | 'voice';
  created_at: string;
  remind_at?: string | null;
  reminder_user_ids?: string[];
  reminder_sent_at?: string | null;
  user_id: string;
  status: 'active' | 'archived';
  file_url?: string;
  file_type?: string;
  file_name?: string;
  file_size?: number;
}
