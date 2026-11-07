import 'server-only';
import {
  ProviderNotConfiguredError,
  type RecordingSourceProvider,
  type SummaryProvider,
  type TelephonyProvider,
  type TranscriptionProvider,
  type VoiceAgentProvider,
} from './types';

// Default adapters used until Phase 2. Every operation fails honestly; health
// checks report "not configured" and are never marked verified.

const notConfiguredHealth = (what: string) => ({
  ok: false,
  verified: false,
  message: `${what} is not configured. Awaiting official documentation for Phase 2 integration.`,
});

export const notConfiguredTelephony: TelephonyProvider = {
  id: 'none',
  displayName: 'Not configured',
  configured: false,
  async placeOutboundCall() {
    throw new ProviderNotConfiguredError('Live outbound calling');
  },
  async hangup() {
    throw new ProviderNotConfiguredError('Live call control');
  },
  async verifyWebhook() {
    return false;
  },
  async parseWebhook() {
    throw new ProviderNotConfiguredError('Telephony webhooks');
  },
  async healthCheck() {
    return notConfiguredHealth('Telephony provider');
  },
};

export const notConfiguredVoiceAgents: VoiceAgentProvider = {
  id: 'none',
  configured: false,
  async upsertAgent() {
    throw new ProviderNotConfiguredError('Voice agent sync');
  },
  async healthCheck() {
    return notConfiguredHealth('Sarvam AI');
  },
};

export const notConfiguredTranscription: TranscriptionProvider = {
  id: 'none',
  configured: false,
  async transcribe() {
    throw new ProviderNotConfiguredError('AI transcription');
  },
};

export const notConfiguredSummaries: SummaryProvider = {
  id: 'none',
  configured: false,
  async summarize() {
    throw new ProviderNotConfiguredError('AI call summaries');
  },
};

export const notConfiguredRecordingSource: RecordingSourceProvider = {
  id: 'none',
  configured: false,
  async getPlaybackUrl() {
    throw new ProviderNotConfiguredError('Provider-hosted recordings');
  },
};
