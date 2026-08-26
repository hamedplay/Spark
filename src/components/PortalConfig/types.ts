export interface ConfigEntry { id: string; section: string; key: string; value: string | null; value_type: string; label: string | null; description: string | null; }
export interface AuditEntry { id: string; user_name: string | null; ip_address: string | null; user_agent: string | null; module: string | null; entity_name: string | null; action: string; details: string | null; severity: string; created_at: string; }
export interface Profile { user_id: string; full_name: string | null; email: string | null; is_admin: boolean | null; is_active: boolean | null; created_at: string | null; avatar_url?: string | null; department?: string | null; position?: string | null; }

export interface Props { currentUserId: string; }
