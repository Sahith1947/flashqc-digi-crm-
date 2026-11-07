import 'server-only';
import type { DB } from '@/lib/supabase/types';
import { getSummaryProvider, getTranscriptionProvider } from '@/server/providers/registry';
import { AppError, ProviderNotConfiguredError } from '@/server/providers/types';

export const TranscriptService = {
  async saveManualTranscript(db: DB, callId: string, input: { content: string; language: string | null }) {
    const content = input.content.trim();
    if (!content) throw new AppError('Transcript cannot be empty');
    if (content.length > 200000) throw new AppError('Transcript is too long (max 200,000 characters)');
    const { data: existing } = await db.from('call_transcripts').select('id, source').eq('call_id', callId).maybeSingle();
    if (existing && existing.source !== 'manual') throw new AppError('This call has a provider transcript that cannot be overwritten');
    const { error } = await db
      .from('call_transcripts')
      .upsert({ call_id: callId, content, language: input.language, source: 'manual' }, { onConflict: 'call_id' });
    if (error) throw error;
  },

  async saveManualSummary(
    db: DB,
    callId: string,
    input: { summary: string; sentiment: 'positive' | 'neutral' | 'negative' | null },
  ) {
    const summary = input.summary.trim();
    if (!summary) throw new AppError('Summary cannot be empty');
    const { data: existing } = await db.from('call_summaries').select('id, source').eq('call_id', callId).maybeSingle();
    if (existing && existing.source !== 'manual') throw new AppError('This call has an AI summary that cannot be overwritten');
    const { error } = await db
      .from('call_summaries')
      .upsert({ call_id: callId, summary, sentiment: input.sentiment, source: 'manual' }, { onConflict: 'call_id' });
    if (error) throw error;
  },

  /** PHASE 2: transcribe a recording with the configured provider (e.g. Sarvam speech-to-text). */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- signature fixed for Phase 2
  async generateTranscript(_db: DB, _callId: string): Promise<never> {
    const provider = getTranscriptionProvider();
    if (!provider.configured) throw new ProviderNotConfiguredError('AI transcription');
    throw new AppError('Transcription adapter not implemented');
  },

  /** PHASE 2: summarise a transcript with the configured provider. */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- signature fixed for Phase 2
  async generateSummary(_db: DB, _callId: string): Promise<never> {
    const provider = getSummaryProvider();
    if (!provider.configured) throw new ProviderNotConfiguredError('AI call summaries');
    throw new AppError('Summary adapter not implemented');
  },

  isAiAvailable() {
    return { transcription: getTranscriptionProvider().configured, summaries: getSummaryProvider().configured };
  },
};
