export type Database = {
  public: {
    Tables: {
      meetings: {
        Row: {
          id: string;
          subject: string;
          request_date: string;
          duration: string;
          location: string;
          representative: string;
          phone: string;
          notes: string | null;
          priority: 'high' | 'medium' | 'low';
          status: 'open' | 'closed';
          status_type: 'requested' | 'approved';
          created_at: string;
          user_id: string;
          guest_emails: string[] | null;
        };
        Insert: {
          id?: string;
          subject: string;
          request_date: string;
          duration: string;
          location: string;
          representative: string;
          phone: string;
          notes?: string | null;
          priority: 'high' | 'medium' | 'low';
          status?: 'open' | 'closed';
          status_type?: 'requested' | 'approved';
          created_at?: string;
          user_id: string;
          guest_emails?: string[] | null;
        };
        Update: {
          id?: string;
          subject?: string;
          request_date?: string;
          duration?: string;
          location?: string;
          representative?: string;
          phone?: string;
          notes?: string | null;
          priority?: 'high' | 'medium' | 'low';
          status?: 'open' | 'closed';
          status_type?: 'requested' | 'approved';
          created_at?: string;
          user_id?: string;
          guest_emails?: string[] | null;
        };
      };
      profiles: {
        Row: {
          id: string;
          user_id: string;
          full_name: string | null;
          email: string | null;
          phone: string | null;
          organization: string | null;
          position: string | null;
          location: string | null;
          bio: string | null;
          avatar_url: string | null;
          telegram_token: string | null;
          telegram_chat_id: string | null;
          webhook_url: string | null;
          google_calendar_token: string | null;
          is_admin: boolean | null;
          is_active: boolean | null;
          user_group: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          full_name?: string | null;
          email?: string | null;
          phone?: string | null;
          organization?: string | null;
          position?: string | null;
          location?: string | null;
          bio?: string | null;
          avatar_url?: string | null;
          telegram_token?: string | null;
          telegram_chat_id?: string | null;
          webhook_url?: string | null;
          google_calendar_token?: string | null;
          is_admin?: boolean | null;
          is_active?: boolean | null;
          user_group?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          full_name?: string | null;
          email?: string | null;
          phone?: string | null;
          organization?: string | null;
          position?: string | null;
          location?: string | null;
          bio?: string | null;
          avatar_url?: string | null;
          telegram_token?: string | null;
          telegram_chat_id?: string | null;
          webhook_url?: string | null;
          google_calendar_token?: string | null;
          is_admin?: boolean | null;
          is_active?: boolean | null;
          user_group?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      participants: {
        Row: {
          id: string;
          meeting_id: string;
          name: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          meeting_id: string;
          name: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          meeting_id?: string;
          name?: string;
          created_at?: string;
        };
      };
      actions: {
        Row: {
          id: string;
          title: string;
          status: 'open' | 'closed';
          meeting_id: string;
          assignee: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          title: string;
          status?: 'open' | 'closed';
          meeting_id: string;
          assignee: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          title?: string;
          status?: 'open' | 'closed';
          meeting_id?: string;
          assignee?: string;
          created_at?: string;
        };
      };
      tasks: {
        Row: {
          id: string;
          title: string;
          description: string;
          status: 'pending' | 'in_progress' | 'completed';
          priority: 'high' | 'medium' | 'low';
          due_date: string;
          assignee: string;
          archived: boolean;
          created_at: string;
          user_id: string;
        };
        Insert: {
          id?: string;
          title: string;
          description: string;
          status?: 'pending' | 'in_progress' | 'completed';
          priority: 'high' | 'medium' | 'low';
          due_date: string;
          assignee: string;
          archived?: boolean;
          created_at?: string;
          user_id: string;
        };
        Update: {
          id?: string;
          title?: string;
          description?: string;
          status?: 'pending' | 'in_progress' | 'completed';
          priority?: 'high' | 'medium' | 'low';
          due_date?: string;
          assignee?: string;
          archived?: boolean;
          created_at?: string;
          user_id?: string;
        };
      };
      notes: {
        Row: {
          id: string;
          title: string;
          content: string;
          note_type: 'text' | 'voice';
          status: 'active' | 'archived';
          file_url: string | null;
          file_type: string | null;
          file_name: string | null;
          file_size: number | null;
          created_at: string;
          user_id: string;
        };
        Insert: {
          id?: string;
          title: string;
          content: string;
          note_type?: 'text' | 'voice';
          status?: 'active' | 'archived';
          file_url?: string | null;
          file_type?: string | null;
          file_name?: string | null;
          file_size?: number | null;
          created_at?: string;
          user_id: string;
        };
        Update: {
          id?: string;
          title?: string;
          content?: string;
          note_type?: 'text' | 'voice';
          status?: 'active' | 'archived';
          file_url?: string | null;
          file_type?: string | null;
          file_name?: string | null;
          file_size?: number | null;
          created_at?: string;
          user_id?: string;
        };
      };
      contacts: {
        Row: {
          id: string;
          name: string;
          phone: string;
          subject: string;
          created_at: string;
          user_id: string;
        };
        Insert: {
          id?: string;
          name: string;
          phone: string;
          subject: string;
          created_at?: string;
          user_id: string;
        };
        Update: {
          id?: string;
          name?: string;
          phone?: string;
          subject?: string;
          created_at?: string;
          user_id?: string;
        };
      };
      contacts_email: {
        Row: {
          id: string;
          name: string;
          email: string;
          user_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          email: string;
          user_id: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          email?: string;
          user_id?: string;
          created_at?: string;
        };
      };
      notifications: {
        Row: {
          id: string;
          user_id: string;
          title: string;
          message: string;
          type: 'meeting' | 'task' | 'note';
          read: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          title: string;
          message: string;
          type: 'meeting' | 'task' | 'note';
          read?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          title?: string;
          message?: string;
          type?: 'meeting' | 'task' | 'note';
          read?: boolean;
          created_at?: string;
        };
      };
      shared_meetings: {
        Row: {
          id: string;
          meeting_id: string | null;
          sender_id: string | null;
          sender_name: string;
          recipient_id: string | null;
          status: 'pending' | 'approved' | 'rejected';
          meeting_data: any | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          meeting_id?: string | null;
          sender_id?: string | null;
          sender_name: string;
          recipient_id?: string | null;
          status?: 'pending' | 'approved' | 'rejected';
          meeting_data?: any | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          meeting_id?: string | null;
          sender_id?: string | null;
          sender_name?: string;
          recipient_id?: string | null;
          status?: 'pending' | 'approved' | 'rejected';
          meeting_data?: any | null;
          created_at?: string;
        };
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      get_all_users: {
        Args: Record<PropertyKey, never>;
        Returns: {
          id: string;
          email: string;
          created_at: string;
          full_name: string | null;
          organization: string | null;
          position: string | null;
        }[];
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};