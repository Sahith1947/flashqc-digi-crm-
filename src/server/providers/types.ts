// Provider-independent contracts for Phase 2 integrations (Sarvam AI, telephony).
//
// Each external capability is a separate interface, because a single vendor
// (or its MCP server) may support only some of them. When Phase 2 starts, an
// adapter is written per capability that the official documentation actually
// supports, and registered in ./registry.ts. Nothing here assumes a capability exists.

export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string = 'app_error',
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class ProviderNotConfiguredError extends AppError {
  constructor(public readonly capability: string) {
    super(
      `${capability} is not connected yet. It will be enabled in Phase 2 once the official provider documentation is integrated.`,
      'provider_not_configured',
    );
    this.name = 'ProviderNotConfiguredError';
  }
}

export interface HealthResult {
  ok: boolean;
  /** true only when the provider itself confirmed connectivity */
  verified: boolean;
  message: string;
}

/** Event shape every telephony adapter must translate its webhooks into. */
export type NormalizedEventType =
  | 'initiated'
  | 'ringing'
  | 'answered'
  | 'completed'
  | 'no_answer'
  | 'busy'
  | 'failed'
  | 'canceled'
  | 'missed'
  | 'recording_ready';

export interface NormalizedCallEvent {
  providerCallId: string;
  type: NormalizedEventType;
  occurredAt: string; // ISO 8601
  direction?: 'inbound' | 'outbound';
  /** remote party in E.164 */
  remoteNumber?: string;
  /** our business line in E.164 */
  businessNumber?: string;
  durationSeconds?: number;
  providerRecordingId?: string;
  failureReason?: string;
  raw: unknown;
}

export interface OutboundCallRequest {
  callId: string; // our internal id, passed as metadata/correlation id
  to: string; // E.164
  from: string | null; // business number E.164
  providerAgentId: string | null;
  metadata?: Record<string, string>;
}

export interface OutboundCallResult {
  providerCallId: string;
  /** status reported by the provider at request time */
  initialStatus: 'queued' | 'ringing' | 'in_progress';
}

export interface TelephonyProvider {
  readonly id: string;
  readonly displayName: string;
  readonly configured: boolean;
  placeOutboundCall(req: OutboundCallRequest): Promise<OutboundCallResult>;
  hangup(providerCallId: string): Promise<void>;
  /** Verify signature/authenticity of an incoming webhook. Must reject anything unverifiable. */
  verifyWebhook(rawBody: string, headers: Headers): Promise<boolean>;
  parseWebhook(rawBody: string, headers: Headers): Promise<NormalizedCallEvent[]>;
  healthCheck(): Promise<HealthResult>;
}

export interface VoiceAgentDefinition {
  name: string;
  language: string;
  voice: string | null;
  greeting: string | null;
  instructions: string | null;
  providerAgentId: string | null;
}

export interface VoiceAgentProvider {
  readonly id: string;
  readonly configured: boolean;
  /** Create or update the agent at the provider; returns the provider's agent id. */
  upsertAgent(def: VoiceAgentDefinition): Promise<{ providerAgentId: string }>;
  healthCheck(): Promise<HealthResult>;
}

export interface TranscriptResult {
  content: string;
  language: string | null;
  segments: { speaker: string; start: number; end: number; text: string }[] | null;
  provider: string;
}

export interface TranscriptionProvider {
  readonly id: string;
  readonly configured: boolean;
  transcribe(audio: { url: string; mimeType: string | null }): Promise<TranscriptResult>;
}

export interface SummaryResult {
  summary: string;
  keyPoints: string[];
  sentiment: 'positive' | 'neutral' | 'negative' | null;
  suggestedOutcome: string | null;
  model: string;
}

export interface SummaryProvider {
  readonly id: string;
  readonly configured: boolean;
  summarize(transcript: string, context: { direction: string; contactName: string | null }): Promise<SummaryResult>;
}

export interface RecordingSourceProvider {
  readonly id: string;
  readonly configured: boolean;
  /** Resolve a short-lived, authenticated playback URL for a provider-hosted recording. */
  getPlaybackUrl(providerRecordingId: string): Promise<string>;
}
