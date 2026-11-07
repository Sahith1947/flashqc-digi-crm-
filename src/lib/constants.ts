// Shared enumerations and display labels. Keep in sync with database CHECK constraints.

export const ROLES = ['admin', 'manager', 'agent', 'viewer'] as const;
export type Role = (typeof ROLES)[number];
export const ROLE_RANK: Record<Role, number> = { admin: 4, manager: 3, agent: 2, viewer: 1 };
export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Admin',
  manager: 'Manager',
  agent: 'Agent',
  viewer: 'Viewer',
};
export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  admin: 'Everything, including team, integrations and settings',
  manager: 'Campaigns, phone numbers, voice agents and deletions',
  agent: 'Contacts, calls, notes, recordings and transcripts',
  viewer: 'Read-only access',
};

export function hasMinRole(role: string | null | undefined, min: Role): boolean {
  if (!role || !(role in ROLE_RANK)) return false;
  return ROLE_RANK[role as Role] >= ROLE_RANK[min];
}

export const CALL_DIRECTIONS = ['inbound', 'outbound'] as const;
export type CallDirection = (typeof CALL_DIRECTIONS)[number];

export const CALL_STATUSES = [
  'queued',
  'ringing',
  'in_progress',
  'completed',
  'no_answer',
  'busy',
  'failed',
  'canceled',
  'missed',
] as const;
export type CallStatus = (typeof CALL_STATUSES)[number];

export const CALL_STATUS_LABELS: Record<CallStatus, string> = {
  queued: 'Queued',
  ringing: 'Ringing',
  in_progress: 'In progress',
  completed: 'Completed',
  no_answer: 'No answer',
  busy: 'Busy',
  failed: 'Failed',
  canceled: 'Canceled',
  missed: 'Missed',
};

/** Status → semantic tone. Uses the reserved status palette; always shown with a label. */
export type Tone = 'good' | 'warning' | 'serious' | 'critical' | 'neutral' | 'info' | 'brand';
export const CALL_STATUS_TONE: Record<CallStatus, Tone> = {
  queued: 'neutral',
  ringing: 'info',
  in_progress: 'info',
  completed: 'good',
  no_answer: 'warning',
  busy: 'serious',
  failed: 'critical',
  canceled: 'neutral',
  missed: 'warning',
};

export const MISSED_STATUSES: CallStatus[] = ['missed', 'no_answer', 'busy'];

export const CALL_OUTCOMES = [
  'interested',
  'not_interested',
  'callback_requested',
  'converted',
  'voicemail',
  'wrong_number',
  'do_not_call',
  'no_response',
  'other',
] as const;
export type CallOutcome = (typeof CALL_OUTCOMES)[number];
export const CALL_OUTCOME_LABELS: Record<CallOutcome | 'not_set', string> = {
  interested: 'Interested',
  not_interested: 'Not interested',
  callback_requested: 'Callback requested',
  converted: 'Converted',
  voicemail: 'Voicemail',
  wrong_number: 'Wrong number',
  do_not_call: 'Do not call',
  no_response: 'No response',
  other: 'Other',
  not_set: 'Not set',
};

export const CONSENT_STATUSES = ['unknown', 'granted', 'revoked'] as const;
export const CONSENT_LABELS: Record<(typeof CONSENT_STATUSES)[number], string> = {
  unknown: 'Unknown',
  granted: 'Granted',
  revoked: 'Revoked',
};
export const DND_STATUSES = ['unknown', 'not_registered', 'registered'] as const;
export const DND_LABELS: Record<(typeof DND_STATUSES)[number], string> = {
  unknown: 'Unknown',
  not_registered: 'Not on DND',
  registered: 'On DND',
};

export const CAMPAIGN_STATUSES = ['draft', 'running', 'paused', 'completed', 'cancelled'] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];
export const CAMPAIGN_STATUS_LABELS: Record<CampaignStatus, string> = {
  draft: 'Draft',
  running: 'Running',
  paused: 'Paused',
  completed: 'Completed',
  cancelled: 'Cancelled',
};
export const CAMPAIGN_STATUS_TONE: Record<CampaignStatus, Tone> = {
  draft: 'neutral',
  running: 'info',
  paused: 'warning',
  completed: 'good',
  cancelled: 'neutral',
};
export const CAMPAIGN_CONTACT_STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  in_progress: 'In progress',
  completed: 'Completed',
  failed: 'Failed',
  skipped: 'Skipped',
};
export const CAMPAIGN_CONTACT_STATUS_TONE: Record<string, Tone> = {
  pending: 'neutral',
  in_progress: 'info',
  completed: 'good',
  failed: 'critical',
  skipped: 'warning',
};

export const PHONE_PROVIDERS = ['unassigned', 'sarvam', 'vobiz', 'exotel', 'twilio', 'plivo', 'knowlarity', 'other'] as const;
export const PHONE_PROVIDER_LABELS: Record<(typeof PHONE_PROVIDERS)[number], string> = {
  unassigned: 'Not assigned',
  sarvam: 'Sarvam AI',
  vobiz: 'Vobiz (via Sarvam)',
  exotel: 'Exotel',
  twilio: 'Twilio',
  plivo: 'Plivo',
  knowlarity: 'Knowlarity',
  other: 'Other',
};

export const CONNECTION_STATUS_LABELS: Record<string, string> = {
  not_connected: 'Not connected',
  connected: 'Connected',
  error: 'Error',
};
export const CONNECTION_STATUS_TONE: Record<string, Tone> = {
  not_connected: 'neutral',
  connected: 'good',
  error: 'critical',
};

export const AGENT_STATUSES = ['draft', 'ready', 'disabled'] as const;
export const AGENT_STATUS_LABELS: Record<(typeof AGENT_STATUSES)[number], string> = {
  draft: 'Draft',
  ready: 'Ready',
  disabled: 'Disabled',
};

export const AGENT_LANGUAGES: { value: string; label: string }[] = [
  { value: 'en-IN', label: 'English (India)' },
  { value: 'hi-IN', label: 'Hindi' },
  { value: 'te-IN', label: 'Telugu' },
  { value: 'ta-IN', label: 'Tamil' },
  { value: 'kn-IN', label: 'Kannada' },
  { value: 'ml-IN', label: 'Malayalam' },
  { value: 'mr-IN', label: 'Marathi' },
  { value: 'gu-IN', label: 'Gujarati' },
  { value: 'bn-IN', label: 'Bengali' },
  { value: 'pa-IN', label: 'Punjabi' },
  { value: 'od-IN', label: 'Odia' },
];

export const SUPPRESSION_SOURCES = ['manual', 'opt_out', 'dnd', 'complaint'] as const;
export const SUPPRESSION_SOURCE_LABELS: Record<(typeof SUPPRESSION_SOURCES)[number], string> = {
  manual: 'Manual',
  opt_out: 'Opted out',
  dnd: 'DND',
  complaint: 'Complaint',
};

export const DATA_SCOPES = ['all', 'live', 'simulated'] as const;
export type DataScope = (typeof DATA_SCOPES)[number];
export const DATA_SCOPE_LABELS: Record<DataScope, string> = {
  all: 'All data',
  live: 'Live only',
  simulated: 'Simulated only',
};
export function parseScope(v: unknown): DataScope {
  return DATA_SCOPES.includes(v as DataScope) ? (v as DataScope) : 'all';
}

export function labelFor<T extends string>(labels: Record<T, string>, value: string | null | undefined, fallback = '—'): string {
  if (!value) return fallback;
  return (labels as Record<string, string>)[value] ?? value;
}
