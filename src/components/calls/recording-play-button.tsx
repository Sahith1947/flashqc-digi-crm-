'use client';
import { useState, useTransition } from 'react';
import { Play } from 'lucide-react';
import { Modal } from '@/components/ui/modal';
import { getCallPlayback } from '@/app/(app)/calls/actions';

/** Play a call's recording straight from the call list. */
export function RecordingPlayButton({
  callId,
  hasRecording,
  label,
  answered = true,
  simulated = false,
}: {
  callId: string;
  hasRecording: boolean;
  label: string;
  answered?: boolean;
  simulated?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<{ url: string | null; error: string | null } | null>(null);
  const [pending, start] = useTransition();
  if (!hasRecording) {
    if (!answered) return <span className="text-xs text-ink-3">—</span>;
    return (
      <span
        className="text-xs whitespace-nowrap text-ink-3"
        title={simulated ? 'Simulated test call: no real audio' : 'The calling provider has not sent a recording for this call yet. The CRM checks again automatically.'}
      >
        {simulated ? 'Test call' : 'Not received'}
      </span>
    );
  }
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          if (!state) start(async () => setState(await getCallPlayback(callId)));
        }}
        className="inline-flex items-center gap-1.5 rounded-full bg-brand-500 py-1 pr-3 pl-2 text-xs font-medium text-ink hover:bg-brand-400"
        aria-label={`Play recording of ${label}`}
        title="Play recording"
        data-testid="play-recording"
      >
        <Play className="size-3.5" fill="currentColor" /> Play
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
