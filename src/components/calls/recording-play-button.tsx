'use client';
import { useState, useTransition } from 'react';
import { AudioLines, Play } from 'lucide-react';
import { Modal } from '@/components/ui/modal';
import { getCallPlayback } from '@/app/(app)/calls/actions';

/** Play a call's recording straight from the call list. */
export function RecordingPlayButton({ callId, hasRecording, label }: { callId: string; hasRecording: boolean; label: string }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<{ url: string | null; error: string | null } | null>(null);
  const [pending, start] = useTransition();
  if (!hasRecording) return <AudioLines className="size-4 opacity-30" aria-label="No recording" />;
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          if (!state) start(async () => setState(await getCallPlayback(callId)));
        }}
        className="inline-flex size-7 items-center justify-center rounded-full bg-brand-500 text-ink hover:bg-brand-400"
        aria-label={`Play recording of ${label}`}
        title="Play recording"
        data-testid="play-recording"
      >
        <Play className="size-3.5" fill="currentColor" />
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={`Recording · ${label}`}>
        {pending && <p className="text-sm text-ink-3">Loading…</p>}
        {state?.url && (
          <audio controls autoPlay src={state.url} className="w-full" data-testid="list-recording-player">
            Your browser does not support audio playback.
          </audio>
        )}
        {state?.error && <p className="text-sm text-red-700">{state.error}</p>}
      </Modal>
    </>
  );
}
