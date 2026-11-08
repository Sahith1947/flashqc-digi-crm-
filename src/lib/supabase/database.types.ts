
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "app_settings": {
                  Row: {
                    "admin_emails": (string)[],"company_name": string,"default_calling_window_end": string,"default_calling_window_start": string,"id": boolean,"sarvam_direct_campaign_id": string | null,"sarvam_direct_campaign_key": string | null,"sarvam_inbound_webhook_at": string | null,"simulation_mode_enabled": boolean,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "admin_emails"?: (string)[],"company_name"?: string,"default_calling_window_end"?: string,"default_calling_window_start"?: string,"id"?: boolean,"sarvam_direct_campaign_id"?: string | null,"sarvam_direct_campaign_key"?: string | null,"sarvam_inbound_webhook_at"?: string | null,"simulation_mode_enabled"?: boolean,"updated_at"?: string
                  }
                  Update: {
                    "admin_emails"?: (string)[],"company_name"?: string,"default_calling_window_end"?: string,"default_calling_window_start"?: string,"id"?: boolean,"sarvam_direct_campaign_id"?: string | null,"sarvam_direct_campaign_key"?: string | null,"sarvam_inbound_webhook_at"?: string | null,"simulation_mode_enabled"?: boolean,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"audit_logs": {
                  Row: {
                    "action": string,"actor_id": string | null,"actor_role": string | null,"created_at": string,"id": number,"new_data": Json | null,"old_data": Json | null,"record_id": string | null,"table_name": string
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor_id"?: string | null,"actor_role"?: string | null,"created_at"?: string,"id"?: never,"new_data"?: Json | null,"old_data"?: Json | null,"record_id"?: string | null,"table_name": string
                  }
                  Update: {
                    "action"?: string,"actor_id"?: string | null,"actor_role"?: string | null,"created_at"?: string,"id"?: never,"new_data"?: Json | null,"old_data"?: Json | null,"record_id"?: string | null,"table_name"?: string
                  }
                  Relationships: [
                    
                  ]
                },"call_events": {
                  Row: {
                    "call_id": string,"created_at": string,"created_by": string | null,"event_type": string,"id": string,"occurred_at": string,"payload": NonNullable<Json>,"source": string,"status": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "call_id": string,"created_at"?: string,"created_by"?: string | null,"event_type": string,"id"?: string,"occurred_at"?: string,"payload"?: NonNullable<Json>,"source": string,"status"?: string | null
                  }
                  Update: {
                    "call_id"?: string,"created_at"?: string,"created_by"?: string | null,"event_type"?: string,"id"?: string,"occurred_at"?: string,"payload"?: NonNullable<Json>,"source"?: string,"status"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "call_events_call_id_fkey"
      columns: ["call_id"]
isOneToOne: false
      referencedRelation: "call_log_view"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "call_events_call_id_fkey"
      columns: ["call_id"]
isOneToOne: false
      referencedRelation: "calls"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "call_events_call_id_fkey"
      columns: ["call_id"]
isOneToOne: false
      referencedRelation: "campaign_results_view"
      referencedColumns: ["call_id"]
    },{
      foreignKeyName: "call_events_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"call_recordings": {
                  Row: {
                    "call_id": string,"created_at": string,"duration_seconds": number | null,"id": string,"mime_type": string | null,"provider_recording_id": string | null,"provider_recording_url": string | null,"size_bytes": number | null,"source": string,"storage_bucket": string | null,"storage_path": string | null,"uploaded_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "call_id": string,"created_at"?: string,"duration_seconds"?: number | null,"id"?: string,"mime_type"?: string | null,"provider_recording_id"?: string | null,"provider_recording_url"?: string | null,"size_bytes"?: number | null,"source": string,"storage_bucket"?: string | null,"storage_path"?: string | null,"uploaded_by"?: string | null
                  }
                  Update: {
                    "call_id"?: string,"created_at"?: string,"duration_seconds"?: number | null,"id"?: string,"mime_type"?: string | null,"provider_recording_id"?: string | null,"provider_recording_url"?: string | null,"size_bytes"?: number | null,"source"?: string,"storage_bucket"?: string | null,"storage_path"?: string | null,"uploaded_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "call_recordings_call_id_fkey"
      columns: ["call_id"]
isOneToOne: false
      referencedRelation: "call_log_view"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "call_recordings_call_id_fkey"
      columns: ["call_id"]
isOneToOne: false
      referencedRelation: "calls"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "call_recordings_call_id_fkey"
      columns: ["call_id"]
isOneToOne: false
      referencedRelation: "campaign_results_view"
      referencedColumns: ["call_id"]
    },{
      foreignKeyName: "call_recordings_uploaded_by_fkey"
      columns: ["uploaded_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"call_summaries": {
                  Row: {
                    "call_id": string,"created_at": string,"created_by": string | null,"emotion": string | null,"id": string,"key_points": Json | null,"model": string | null,"sentiment": string | null,"source": string,"suggested_outcome": string | null,"summary": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "call_id": string,"created_at"?: string,"created_by"?: string | null,"emotion"?: string | null,"id"?: string,"key_points"?: Json | null,"model"?: string | null,"sentiment"?: string | null,"source": string,"suggested_outcome"?: string | null,"summary": string,"updated_at"?: string
                  }
                  Update: {
                    "call_id"?: string,"created_at"?: string,"created_by"?: string | null,"emotion"?: string | null,"id"?: string,"key_points"?: Json | null,"model"?: string | null,"sentiment"?: string | null,"source"?: string,"suggested_outcome"?: string | null,"summary"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "call_summaries_call_id_fkey"
      columns: ["call_id"]
isOneToOne: true
      referencedRelation: "call_log_view"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "call_summaries_call_id_fkey"
      columns: ["call_id"]
isOneToOne: true
      referencedRelation: "calls"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "call_summaries_call_id_fkey"
      columns: ["call_id"]
isOneToOne: true
      referencedRelation: "campaign_results_view"
      referencedColumns: ["call_id"]
    },{
      foreignKeyName: "call_summaries_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"call_transcripts": {
                  Row: {
                    "call_id": string,"content": string,"created_at": string,"created_by": string | null,"id": string,"language": string | null,"provider": string | null,"segments": Json | null,"source": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "call_id": string,"content": string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"language"?: string | null,"provider"?: string | null,"segments"?: Json | null,"source": string,"updated_at"?: string
                  }
                  Update: {
                    "call_id"?: string,"content"?: string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"language"?: string | null,"provider"?: string | null,"segments"?: Json | null,"source"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "call_transcripts_call_id_fkey"
      columns: ["call_id"]
isOneToOne: true
      referencedRelation: "call_log_view"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "call_transcripts_call_id_fkey"
      columns: ["call_id"]
isOneToOne: true
      referencedRelation: "calls"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "call_transcripts_call_id_fkey"
      columns: ["call_id"]
isOneToOne: true
      referencedRelation: "campaign_results_view"
      referencedColumns: ["call_id"]
    },{
      foreignKeyName: "call_transcripts_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"calls": {
                  Row: {
                    "answered_at": string | null,"call_number": number,"campaign_id": string | null,"contact_id": string | null,"created_at": string,"created_by": string | null,"direction": string,"duration_seconds": number,"ended_at": string | null,"failure_reason": string | null,"id": string,"is_simulated": boolean,"notes": string | null,"outcome": string | null,"phone_e164": string,"phone_number_id": string | null,"provider": string | null,"provider_call_id": string | null,"started_at": string,"status": string,"updated_at": string,"voice_agent_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "answered_at"?: string | null,"call_number"?: number,"campaign_id"?: string | null,"contact_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"direction": string,"duration_seconds"?: number,"ended_at"?: string | null,"failure_reason"?: string | null,"id"?: string,"is_simulated"?: boolean,"notes"?: string | null,"outcome"?: string | null,"phone_e164": string,"phone_number_id"?: string | null,"provider"?: string | null,"provider_call_id"?: string | null,"started_at"?: string,"status"?: string,"updated_at"?: string,"voice_agent_id"?: string | null
                  }
                  Update: {
                    "answered_at"?: string | null,"call_number"?: number,"campaign_id"?: string | null,"contact_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"direction"?: string,"duration_seconds"?: number,"ended_at"?: string | null,"failure_reason"?: string | null,"id"?: string,"is_simulated"?: boolean,"notes"?: string | null,"outcome"?: string | null,"phone_e164"?: string,"phone_number_id"?: string | null,"provider"?: string | null,"provider_call_id"?: string | null,"started_at"?: string,"status"?: string,"updated_at"?: string,"voice_agent_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "calls_campaign_id_fkey"
      columns: ["campaign_id"]
isOneToOne: false
      referencedRelation: "campaign_stats"
      referencedColumns: ["campaign_id"]
    },{
      foreignKeyName: "calls_campaign_id_fkey"
      columns: ["campaign_id"]
isOneToOne: false
      referencedRelation: "campaigns"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "calls_contact_id_fkey"
      columns: ["contact_id"]
isOneToOne: false
      referencedRelation: "campaign_results_view"
      referencedColumns: ["contact_id"]
    },{
      foreignKeyName: "calls_contact_id_fkey"
      columns: ["contact_id"]
isOneToOne: false
      referencedRelation: "contacts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "calls_contact_id_fkey"
      columns: ["contact_id"]
isOneToOne: false
      referencedRelation: "contacts_with_stats"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "calls_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "calls_phone_number_id_fkey"
      columns: ["phone_number_id"]
isOneToOne: false
      referencedRelation: "phone_numbers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "calls_voice_agent_id_fkey"
      columns: ["voice_agent_id"]
isOneToOne: false
      referencedRelation: "voice_agents"
      referencedColumns: ["id"]
    }
                  ]
                },"campaign_contacts": {
                  Row: {
                    "attempts": number,"campaign_id": string,"contact_id": string,"created_at": string,"id": string,"last_attempt_at": string | null,"last_call_id": string | null,"outcome": string | null,"skip_reason": string | null,"status": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "attempts"?: number,"campaign_id": string,"contact_id": string,"created_at"?: string,"id"?: string,"last_attempt_at"?: string | null,"last_call_id"?: string | null,"outcome"?: string | null,"skip_reason"?: string | null,"status"?: string,"updated_at"?: string
                  }
                  Update: {
                    "attempts"?: number,"campaign_id"?: string,"contact_id"?: string,"created_at"?: string,"id"?: string,"last_attempt_at"?: string | null,"last_call_id"?: string | null,"outcome"?: string | null,"skip_reason"?: string | null,"status"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "campaign_contacts_campaign_id_fkey"
      columns: ["campaign_id"]
isOneToOne: false
      referencedRelation: "campaign_stats"
      referencedColumns: ["campaign_id"]
    },{
      foreignKeyName: "campaign_contacts_campaign_id_fkey"
      columns: ["campaign_id"]
isOneToOne: false
      referencedRelation: "campaigns"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "campaign_contacts_contact_id_fkey"
      columns: ["contact_id"]
isOneToOne: false
      referencedRelation: "campaign_results_view"
      referencedColumns: ["contact_id"]
    },{
      foreignKeyName: "campaign_contacts_contact_id_fkey"
      columns: ["contact_id"]
isOneToOne: false
      referencedRelation: "contacts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "campaign_contacts_contact_id_fkey"
      columns: ["contact_id"]
isOneToOne: false
      referencedRelation: "contacts_with_stats"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "campaign_contacts_last_call_id_fkey"
      columns: ["last_call_id"]
isOneToOne: false
      referencedRelation: "call_log_view"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "campaign_contacts_last_call_id_fkey"
      columns: ["last_call_id"]
isOneToOne: false
      referencedRelation: "calls"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "campaign_contacts_last_call_id_fkey"
      columns: ["last_call_id"]
isOneToOne: false
      referencedRelation: "campaign_results_view"
      referencedColumns: ["call_id"]
    }
                  ]
                },"campaigns": {
                  Row: {
                    "calling_window_end": string,"calling_window_start": string,"completed_at": string | null,"created_at": string,"created_by": string | null,"description": string | null,"id": string,"max_attempts": number,"mode": string,"name": string,"paused_at": string | null,"phone_number_id": string | null,"provider": string | null,"provider_campaign_id": string | null,"provider_synced_at": string | null,"started_at": string | null,"status": string,"updated_at": string,"voice_agent_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "calling_window_end"?: string,"calling_window_start"?: string,"completed_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"description"?: string | null,"id"?: string,"max_attempts"?: number,"mode"?: string,"name": string,"paused_at"?: string | null,"phone_number_id"?: string | null,"provider"?: string | null,"provider_campaign_id"?: string | null,"provider_synced_at"?: string | null,"started_at"?: string | null,"status"?: string,"updated_at"?: string,"voice_agent_id"?: string | null
                  }
                  Update: {
                    "calling_window_end"?: string,"calling_window_start"?: string,"completed_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"description"?: string | null,"id"?: string,"max_attempts"?: number,"mode"?: string,"name"?: string,"paused_at"?: string | null,"phone_number_id"?: string | null,"provider"?: string | null,"provider_campaign_id"?: string | null,"provider_synced_at"?: string | null,"started_at"?: string | null,"status"?: string,"updated_at"?: string,"voice_agent_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "campaigns_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "campaigns_phone_number_id_fkey"
      columns: ["phone_number_id"]
isOneToOne: false
      referencedRelation: "phone_numbers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "campaigns_voice_agent_id_fkey"
      columns: ["voice_agent_id"]
isOneToOne: false
      referencedRelation: "voice_agents"
      referencedColumns: ["id"]
    }
                  ]
                },"contacts": {
                  Row: {
                    "business_category": string | null,"business_name": string | null,"city": string | null,"consent_status": string,"created_at": string,"created_by": string | null,"dnd_status": string,"full_name": string | null,"id": string,"last_emotion": string | null,"lead_details": Json | null,"lead_stage": string,"lead_temperature": string | null,"lead_updated_at": string | null,"notes": string | null,"phone_e164": string,"source": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "business_category"?: string | null,"business_name"?: string | null,"city"?: string | null,"consent_status"?: string,"created_at"?: string,"created_by"?: string | null,"dnd_status"?: string,"full_name"?: string | null,"id"?: string,"last_emotion"?: string | null,"lead_details"?: Json | null,"lead_stage"?: string,"lead_temperature"?: string | null,"lead_updated_at"?: string | null,"notes"?: string | null,"phone_e164": string,"source"?: string,"updated_at"?: string
                  }
                  Update: {
                    "business_category"?: string | null,"business_name"?: string | null,"city"?: string | null,"consent_status"?: string,"created_at"?: string,"created_by"?: string | null,"dnd_status"?: string,"full_name"?: string | null,"id"?: string,"last_emotion"?: string | null,"lead_details"?: Json | null,"lead_stage"?: string,"lead_temperature"?: string | null,"lead_updated_at"?: string | null,"notes"?: string | null,"phone_e164"?: string,"source"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "contacts_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"integration_credentials": {
                  Row: {
                    "ciphertext": string,"created_at": string,"key": string,"metadata": NonNullable<Json>,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "ciphertext": string,"created_at"?: string,"key": string,"metadata"?: NonNullable<Json>,"updated_at"?: string
                  }
                  Update: {
                    "ciphertext"?: string,"created_at"?: string,"key"?: string,"metadata"?: NonNullable<Json>,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"integrations": {
                  Row: {
                    "config": NonNullable<Json>,"created_at": string,"display_name": string,"id": string,"key": string,"last_checked_at": string | null,"last_error": string | null,"provider": string | null,"status": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "config"?: NonNullable<Json>,"created_at"?: string,"display_name": string,"id"?: string,"key": string,"last_checked_at"?: string | null,"last_error"?: string | null,"provider"?: string | null,"status"?: string,"updated_at"?: string
                  }
                  Update: {
                    "config"?: NonNullable<Json>,"created_at"?: string,"display_name"?: string,"id"?: string,"key"?: string,"last_checked_at"?: string | null,"last_error"?: string | null,"provider"?: string | null,"status"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"phone_numbers": {
                  Row: {
                    "can_inbound": boolean,"can_outbound": boolean,"connection_status": string,"created_at": string,"created_by": string | null,"enabled": boolean,"id": string,"label": string,"phone_e164": string,"provider": string,"provider_connection_id": string | null,"provider_number_id": string | null,"provider_synced_at": string | null,"updated_at": string,"voice_agent_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "can_inbound"?: boolean,"can_outbound"?: boolean,"connection_status"?: string,"created_at"?: string,"created_by"?: string | null,"enabled"?: boolean,"id"?: string,"label": string,"phone_e164": string,"provider"?: string,"provider_connection_id"?: string | null,"provider_number_id"?: string | null,"provider_synced_at"?: string | null,"updated_at"?: string,"voice_agent_id"?: string | null
                  }
                  Update: {
                    "can_inbound"?: boolean,"can_outbound"?: boolean,"connection_status"?: string,"created_at"?: string,"created_by"?: string | null,"enabled"?: boolean,"id"?: string,"label"?: string,"phone_e164"?: string,"provider"?: string,"provider_connection_id"?: string | null,"provider_number_id"?: string | null,"provider_synced_at"?: string | null,"updated_at"?: string,"voice_agent_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "phone_numbers_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "phone_numbers_voice_agent_id_fkey"
      columns: ["voice_agent_id"]
isOneToOne: false
      referencedRelation: "voice_agents"
      referencedColumns: ["id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "created_at": string,"email": string,"full_name": string | null,"id": string,"is_active": boolean,"role": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"email": string,"full_name"?: string | null,"id": string,"is_active"?: boolean,"role"?: string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"email"?: string,"full_name"?: string | null,"id"?: string,"is_active"?: boolean,"role"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"suppression_list": {
                  Row: {
                    "added_by": string | null,"created_at": string,"id": string,"phone_e164": string,"reason": string | null,"source": string
                  }
                  ComputedFields: never
                  Insert: {
                    "added_by"?: string | null,"created_at"?: string,"id"?: string,"phone_e164": string,"reason"?: string | null,"source"?: string
                  }
                  Update: {
                    "added_by"?: string | null,"created_at"?: string,"id"?: string,"phone_e164"?: string,"reason"?: string | null,"source"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "suppression_list_added_by_fkey"
      columns: ["added_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"voice_agents": {
                  Row: {
                    "connection_status": string,"created_at": string,"created_by": string | null,"description": string | null,"greeting": string | null,"id": string,"instructions": string | null,"language": string,"name": string,"provider": string,"provider_agent_id": string | null,"provider_committed_version": number | null,"provider_deployed": boolean | null,"provider_status": string | null,"provider_synced_at": string | null,"provider_version": number | null,"status": string,"updated_at": string,"voice": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "connection_status"?: string,"created_at"?: string,"created_by"?: string | null,"description"?: string | null,"greeting"?: string | null,"id"?: string,"instructions"?: string | null,"language"?: string,"name": string,"provider"?: string,"provider_agent_id"?: string | null,"provider_committed_version"?: number | null,"provider_deployed"?: boolean | null,"provider_status"?: string | null,"provider_synced_at"?: string | null,"provider_version"?: number | null,"status"?: string,"updated_at"?: string,"voice"?: string | null
                  }
                  Update: {
                    "connection_status"?: string,"created_at"?: string,"created_by"?: string | null,"description"?: string | null,"greeting"?: string | null,"id"?: string,"instructions"?: string | null,"language"?: string,"name"?: string,"provider"?: string,"provider_agent_id"?: string | null,"provider_committed_version"?: number | null,"provider_deployed"?: boolean | null,"provider_status"?: string | null,"provider_synced_at"?: string | null,"provider_version"?: number | null,"status"?: string,"updated_at"?: string,"voice"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "voice_agents_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            "call_log_view": {
                  Row: {
                    "answered_at": string | null,"business_name": string | null,"business_phone_e164": string | null,"call_number": number,"campaign_id": string | null,"campaign_name": string | null,"contact_id": string | null,"contact_name": string | null,"created_at": string,"created_by": string | null,"direction": string,"duration_seconds": number,"emotion": string | null,"ended_at": string | null,"failure_reason": string | null,"has_recording": boolean | null,"has_summary": boolean | null,"has_transcript": boolean | null,"id": string,"interest": string | null,"is_answered": boolean | null,"is_simulated": boolean,"notes": string | null,"outcome": string | null,"phone_e164": string,"phone_number_id": string | null,"phone_number_label": string | null,"provider": string | null,"provider_call_id": string | null,"sentiment": string | null,"started_at": string,"status": string,"updated_at": string,"voice_agent_id": string | null,"voice_agent_name": string | null
                  }
                  ComputedFields: never
                  Relationships: [
                    {
      foreignKeyName: "calls_campaign_id_fkey"
      columns: ["campaign_id"]
isOneToOne: false
      referencedRelation: "campaign_stats"
      referencedColumns: ["campaign_id"]
    },{
      foreignKeyName: "calls_campaign_id_fkey"
      columns: ["campaign_id"]
isOneToOne: false
      referencedRelation: "campaigns"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "calls_contact_id_fkey"
      columns: ["contact_id"]
isOneToOne: false
      referencedRelation: "campaign_results_view"
      referencedColumns: ["contact_id"]
    },{
      foreignKeyName: "calls_contact_id_fkey"
      columns: ["contact_id"]
isOneToOne: false
      referencedRelation: "contacts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "calls_contact_id_fkey"
      columns: ["contact_id"]
isOneToOne: false
      referencedRelation: "contacts_with_stats"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "calls_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "calls_phone_number_id_fkey"
      columns: ["phone_number_id"]
isOneToOne: false
      referencedRelation: "phone_numbers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "calls_voice_agent_id_fkey"
      columns: ["voice_agent_id"]
isOneToOne: false
      referencedRelation: "voice_agents"
      referencedColumns: ["id"]
    }
                  ]
                },"campaign_results_view": {
                  Row: {
                    "attempts": number,"business_name": string | null,"call_id": string | null,"call_status": string | null,"campaign_contact_id": string,"campaign_id": string,"contact_id": string,"contact_status": string,"created_at": string,"duration_seconds": number | null,"emotion": string | null,"full_name": string | null,"has_recording": boolean | null,"interest": string | null,"is_answered": boolean | null,"last_attempt_at": string | null,"lead_stage": string,"lead_temperature": string | null,"outcome": string | null,"phone_e164": string,"skip_reason": string | null,"summary": string | null
                  }
                  ComputedFields: never
                  Relationships: [
                    {
      foreignKeyName: "campaign_contacts_campaign_id_fkey"
      columns: ["campaign_id"]
isOneToOne: false
      referencedRelation: "campaign_stats"
      referencedColumns: ["campaign_id"]
    },{
      foreignKeyName: "campaign_contacts_campaign_id_fkey"
      columns: ["campaign_id"]
isOneToOne: false
      referencedRelation: "campaigns"
      referencedColumns: ["id"]
    }
                  ]
                },"campaign_stats": {
                  Row: {
                    "avg_duration_seconds": number | null,"calls_answered": number | null,"calls_failed": number | null,"calls_missed": number | null,"calls_total": number | null,"campaign_id": string,"contacts_completed": number | null,"contacts_failed": number | null,"contacts_in_progress": number | null,"contacts_pending": number | null,"contacts_skipped": number | null,"contacts_total": number | null,"talk_time_seconds": number | null
                  }
                  ComputedFields: never
                  Relationships: [
                    
                  ]
                },"contacts_with_stats": {
                  Row: {
                    "business_category": string | null,"business_name": string | null,"city": string | null,"consent_status": string,"created_at": string,"created_by": string | null,"dnd_status": string,"full_name": string | null,"id": string,"is_suppressed": boolean | null,"last_call_at": string | null,"last_call_outcome": string | null,"last_call_status": string | null,"last_emotion": string | null,"lead_details": Json | null,"lead_stage": string,"lead_temperature": string | null,"lead_updated_at": string | null,"notes": string | null,"phone_e164": string,"source": string,"total_calls": number | null,"updated_at": string
                  }
                  ComputedFields: never
                  Relationships: [
                    {
      foreignKeyName: "contacts_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"recording_library_view": {
                  Row: {
                    "business_name": string | null,"call_id": string,"call_number": number,"call_started_at": string,"call_status": string,"campaign_id": string | null,"campaign_name": string | null,"contact_id": string | null,"contact_name": string | null,"created_at": string,"direction": string,"duration_seconds": number | null,"has_summary": boolean | null,"has_transcript": boolean | null,"id": string,"is_simulated": boolean,"mime_type": string | null,"phone_e164": string,"provider_recording_id": string | null,"provider_recording_url": string | null,"size_bytes": number | null,"source": string,"storage_bucket": string | null,"storage_path": string | null
                  }
                  ComputedFields: never
                  Relationships: [
                    {
      foreignKeyName: "call_recordings_call_id_fkey"
      columns: ["call_id"]
isOneToOne: false
      referencedRelation: "call_log_view"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "call_recordings_call_id_fkey"
      columns: ["call_id"]
isOneToOne: false
      referencedRelation: "calls"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "call_recordings_call_id_fkey"
      columns: ["call_id"]
isOneToOne: false
      referencedRelation: "campaign_results_view"
      referencedColumns: ["call_id"]
    },{
      foreignKeyName: "calls_campaign_id_fkey"
      columns: ["campaign_id"]
isOneToOne: false
      referencedRelation: "campaign_stats"
      referencedColumns: ["campaign_id"]
    },{
      foreignKeyName: "calls_campaign_id_fkey"
      columns: ["campaign_id"]
isOneToOne: false
      referencedRelation: "campaigns"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "calls_contact_id_fkey"
      columns: ["contact_id"]
isOneToOne: false
      referencedRelation: "campaign_results_view"
      referencedColumns: ["contact_id"]
    },{
      foreignKeyName: "calls_contact_id_fkey"
      columns: ["contact_id"]
isOneToOne: false
      referencedRelation: "contacts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "calls_contact_id_fkey"
      columns: ["contact_id"]
isOneToOne: false
      referencedRelation: "contacts_with_stats"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Functions: {
            "call_interest":
{ Args: { "p_answered": boolean,"p_duration": number,"p_emotion": string,"p_outcome": string }; Returns: string
                           },
"call_trends":
{ Args: { "p_from": string,"p_granularity"?: string,"p_scope"?: string,"p_to": string }; Returns: {
              "answered": number,"bucket": string,"failed": number,"inbound": number,"missed": number,"outbound": number,"total": number
            }[]
                           },
"current_app_role":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"dashboard_summary":
{ Args: { "p_from": string,"p_scope"?: string,"p_to": string }; Returns: Json
                           },
"has_min_role":
{ Args: { "p_min_role": string }; Returns: boolean
                           },
"hourly_distribution":
{ Args: { "p_from": string,"p_scope"?: string,"p_to": string }; Returns: {
              "answered": number,"hour": number,"total": number
            }[]
                           },
"is_backend_context":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"outcome_distribution":
{ Args: { "p_from": string,"p_scope"?: string,"p_to": string }; Returns: {
              "outcome": string,"total": number
            }[]
                           },
"renumber_call_numbers":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"role_rank":
{ Args: { "p_role": string }; Returns: number
                           },
"scope_matches":
{ Args: { "p_is_simulated": boolean,"p_scope": string }; Returns: boolean
                           },
"voice_agent_performance":
{ Args: { "p_from": string,"p_scope"?: string,"p_to": string }; Returns: {
              "answered": number,"avg_duration_seconds": number,"name": string,"talk_time_seconds": number,"total": number,"voice_agent_id": string
            }[]
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            
          }
        }
} as const
