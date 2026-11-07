import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

export type { Database };
export type DB = SupabaseClient<Database>;
export type Tables<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row'];
export type Views<T extends keyof Database['public']['Views']> = Database['public']['Views'][T]['Row'];
export type Profile = Tables<'profiles'>;
export type Contact = Tables<'contacts'>;
export type Call = Tables<'calls'>;
export type CallLogRow = Views<'call_log_view'>;
export type ContactWithStats = Views<'contacts_with_stats'>;
export type Campaign = Tables<'campaigns'>;
export type CampaignStats = Views<'campaign_stats'>;
export type PhoneNumber = Tables<'phone_numbers'>;
export type VoiceAgent = Tables<'voice_agents'>;
export type Integration = Tables<'integrations'>;
export type RecordingRow = Views<'recording_library_view'>;
