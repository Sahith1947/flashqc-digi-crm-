'use server';
import { z } from 'zod';
import { assertRole } from '@/server/auth';

/** Lazily loads transcript + summary for the recording library viewer. */
export async function getCallArtifacts(callId: string) {
  const { db } = await assertRole('viewer');
  const id = z.string().uuid().parse(callId);
  const [t, s] = await Promise.all([
    db.from('call_transcripts').select('content, language, source, updated_at').eq('call_id', id).maybeSingle(),
    db.from('call_summaries').select('summary, sentiment, source, model, updated_at').eq('call_id', id).maybeSingle(),
  ]);
  return { transcript: t.data, summary: s.data };
}
