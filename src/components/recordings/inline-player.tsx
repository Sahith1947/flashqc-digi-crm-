'use client';
import { useState, useTransition } from 'react';
import { Play } from 'lucide-react';
import { getCallPlayback } from '@/app/(app)/calls/actions';

/** Inline player for a recording that is fetched on first play (e.g. from Sarvam). */
export function InlineRecordingPlayer({ callId }: { callId: string }) {
  const [state, setState] = useState<{ url: string | null; error: string | null } | null>(null);
  const [pending, start] = useTransition();
  if (state?.url)
    return (
      <audio controls autoPlay src={state.url} className="h-9 w-full" data-testid="recording-player">
        Your browser does not support audio playback.
      </audio>
    );
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        disabled={pending}
        onClick={() => start(async () => setState(await getCallPlayback(callId)))}
        className="inline-flex items-center gap-1.5 rounded-full bg-brand-500 py-1.5 pr-3.5 pl-2.5 text-xs font-medium text-ink hover:bg-brand-400 disabled:opacity-60"
        data-testid="inline-play"
      >
        <Play className="size-3.5" fill="currentColor" /> {pending ? 'Loading recording…' : 'Play'}
      </button>
      {state?.error && <span className="text-xs text-red-700">{state.error}</span>}
    </div>
  );
}
