export interface ActionChecklistItem {
  id: string;
  task_id: string;
  title: string;
  is_completed: boolean;
  sort_order: number;
  created_by: string;
  created_at: string;
  completed_at?: string | null;
}

export interface ActionAttachment {
  id: string;
  task_id: string;
  file_name: string;
  file_path: string;
  file_size?: number | null;
  mime_type?: string | null;
  uploaded_by: string;
  created_at: string;
}

export interface ActionDependency {
  id: string;
  task_id: string;
  depends_on_task_id: string;
  created_by: string;
  created_at: string;
}
