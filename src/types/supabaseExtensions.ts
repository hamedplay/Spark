import type { Database as BaseDatabase } from './supabase';

type PublicSchema = BaseDatabase['public'];
type ProfileTable = PublicSchema['Tables']['profiles'];
type UserPreferencesTable = PublicSchema['Tables']['user_preferences'];

export type Database = Omit<BaseDatabase, 'public'> & {
  public: Omit<PublicSchema, 'Tables' | 'Functions'> & {
    Tables: Omit<PublicSchema['Tables'], 'profiles' | 'user_preferences'> & {
      profiles: {
        Row: ProfileTable['Row'] & {
          is_security_admin: boolean;
          security_role_version: number;
          account_status: string;
          registration_source: 'legacy' | 'public_phone_registration' | 'admin_created' | 'imported';
        };
        Insert: ProfileTable['Insert'] & {
          is_security_admin?: boolean;
          security_role_version?: number;
          account_status?: string;
          registration_source?: 'legacy' | 'public_phone_registration' | 'admin_created' | 'imported';
        };
        Update: ProfileTable['Update'] & {
          is_security_admin?: boolean;
          security_role_version?: number;
          account_status?: string;
          registration_source?: 'legacy' | 'public_phone_registration' | 'admin_created' | 'imported';
        };
        Relationships: ProfileTable['Relationships'];
      };
      user_preferences: {
        Row: UserPreferencesTable['Row'] & {
          onboarding_version: number;
          onboarding_status: 'pending' | 'completed' | 'skipped';
          onboarding_completed_at: string | null;
          onboarding_skipped_at: string | null;
        };
        Insert: UserPreferencesTable['Insert'] & {
          onboarding_version?: number;
          onboarding_status?: 'pending' | 'completed' | 'skipped';
          onboarding_completed_at?: string | null;
          onboarding_skipped_at?: string | null;
        };
        Update: UserPreferencesTable['Update'] & {
          onboarding_version?: number;
          onboarding_status?: 'pending' | 'completed' | 'skipped';
          onboarding_completed_at?: string | null;
          onboarding_skipped_at?: string | null;
        };
        Relationships: UserPreferencesTable['Relationships'];
      };
    };
    Functions: PublicSchema['Functions'] & {
      set_user_role_level: {
        Args: {
          p_target_user_id: string;
          p_role: 'user' | 'admin' | 'security_admin';
          p_change_reason?: string | null;
        };
        Returns: {
          ok?: boolean;
          error?: string;
          role?: 'user' | 'admin' | 'security_admin';
          new_version?: number;
          current_role?: 'user' | 'admin' | 'security_admin';
        };
      };
      get_my_app_bootstrap_v1: {
        Args: Record<PropertyKey, never>;
        Returns: {
          has_session?: boolean;
          access_level?: string;
          reason_code?: string;
          next_step?: string | null;
          user_id?: string | null;
          session_id?: string | null;
          account_status?: string | null;
          profile_completion_status?: string | null;
          mfa_required?: boolean;
          has_verified_totp?: boolean;
          current_aal?: string | null;
          is_admin?: boolean;
          permissions?: Record<string, boolean> | null;
        };
      };
    };
  };
};