import 'server-only';
import { serverEnv } from '@/server/env';
import {
  notConfiguredRecordingSource,
  notConfiguredSummaries,
  notConfiguredTelephony,
  notConfiguredTranscription,
  notConfiguredVoiceAgents,
} from './not-configured';
import type {
  RecordingSourceProvider,
  SummaryProvider,
  TelephonyProvider,
  TranscriptionProvider,
  VoiceAgentProvider,
} from './types';

// Single place where concrete adapters are selected.
//
// PHASE 2: implement adapters in this folder (e.g. ./sarvam/*.ts) strictly
// from the official documentation, then register them below. Register only
// the capabilities the docs/MCP actually support; leave the others on the
// not-configured adapters.

const telephonyAdapters: Record<string, () => TelephonyProvider> = {
  // sarvam: () => createSarvamTelephony(serverEnv),
  // exotel: () => createExotelTelephony(serverEnv),
};

export function getTelephonyProvider(id: string = serverEnv.telephonyProvider): TelephonyProvider {
  const factory = id ? telephonyAdapters[id] : undefined;
  return factory ? factory() : notConfiguredTelephony;
}

export function getVoiceAgentProvider(): VoiceAgentProvider {
  return notConfiguredVoiceAgents;
}

export function getTranscriptionProvider(): TranscriptionProvider {
  return notConfiguredTranscription;
}

export function getSummaryProvider(): SummaryProvider {
  return notConfiguredSummaries;
}

export function getRecordingSourceProvider(): RecordingSourceProvider {
  return notConfiguredRecordingSource;
}

export function integrationReadiness() {
  return {
    telephony: getTelephonyProvider().configured,
    voiceAgents: getVoiceAgentProvider().configured,
    transcription: getTranscriptionProvider().configured,
    summaries: getSummaryProvider().configured,
    providerRecordings: getRecordingSourceProvider().configured,
  };
}
