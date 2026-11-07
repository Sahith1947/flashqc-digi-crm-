'use client';
import { useFormAction } from '@/components/ui/use-form-action';
import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Upload } from 'lucide-react';
import type { ActionResult } from '@/lib/action-result';
import { CALL_OUTCOME_LABELS, CALL_OUTCOMES } from '@/lib/constants';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { useActionToast, useOnSuccess, useToast } from '@/components/ui/toast';
import { registerRecording, saveCallerAsContact, saveSummary, saveTranscript, updateCallOutcome } from '@/app/(app)/calls/actions';

type BoundAction = (prev: ActionResult | null, fd: FormData) => Promise<ActionResult>;

export function OutcomeForm({ callId, outcome, notes, canEdit }: { callId: string; outcome: string | null; notes: string | null; canEdit: boolean }) {
  const { state, pending, onSubmit: action } = useFormAction<ActionResult | null>(updateCallOutcome.bind(null, callId) as BoundAction);
  useActionToast(state);
  return (
    <form onSubmit={action} className="space-y-4">
      <Field label="Outcome" htmlFor="outcome" hint='"Do not call" also adds the number to the suppression list.'>
        <Select id="outcome" name="outcome" defaultValue={outcome ?? ''} disabled={!canEdit}>
          <option value="">Not set</option>
          {CALL_OUTCOMES.map((o) => (
            <option key={o} value={o}>
              {CALL_OUTCOME_LABELS[o]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Notes" htmlFor="notes">
        <Textarea id="notes" name="notes" rows={4} maxLength={5000} defaultValue={notes ?? ''} disabled={!canEdit} placeholder="What was discussed, next steps…" />
      </Field>
      {canEdit && (
        <Button type="submit" pending={pending}>
          Save outcome
        </Button>
      )}
    </form>
  );
}

export function SaveContactForm({ callId }: { callId: string }) {
  // On success the page re-renders without this form, so the toast is pushed from the
  // submit callback (the provider lives at the root) rather than from an effect here.
  const [pending, start] = useTransition();
  const { push } = useToast();
  const router = useRouter();
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        start(async () => {
          const res = await saveCallerAsContact(callId, null, fd);
          if (res.ok) {
            push('success', res.message);
            router.refresh();
          } else push('error', res.error);
        });
      }}
    >
      <Field label="Name" htmlFor="sc_name">
        <Input id="sc_name" name="full_name" maxLength={200} />
      </Field>
      <Field label="Business" htmlFor="sc_business">
        <Input id="sc_business" name="business_name" maxLength={200} />
      </Field>
      <Button type="submit" variant="dark" size="sm" pending={pending}>
        Save as contact
      </Button>
    </form>
  );
}

export function TranscriptForm({ callId, content, language, onDone }: { callId: string; content: string; language: string | null; onDone?: () => void }) {
  const { state, pending, onSubmit: action } = useFormAction<ActionResult | null>(saveTranscript.bind(null, callId) as BoundAction);
  useActionToast(state);
  const ref = useRef<HTMLTextAreaElement>(null);
  useOnSuccess(state, () => onDone?.());
  return (
    <form onSubmit={action} className="space-y-3">
      <Field label="Transcript" htmlFor="t_content" hint="Paste text or load a .txt file. Saved as a manual transcript.">
        <Textarea id="t_content" name="content" ref={ref} rows={10} defaultValue={content} required maxLength={200000} />
      </Field>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Language" htmlFor="t_lang" className="w-40">
          <Input id="t_lang" name="language" defaultValue={language ?? ''} placeholder="e.g. en-IN" maxLength={20} />
        </Field>
        <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-line-strong px-3 text-sm hover:bg-canvas">
          <Upload className="size-4" /> Load .txt
          <input
            type="file"
            accept=".txt,text/plain"
            className="sr-only"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f && ref.current) ref.current.value = (await f.text()).slice(0, 200000);
            }}
          />
        </label>
        <Button type="submit" pending={pending}>
          Save transcript
        </Button>
      </div>
    </form>
  );
}

export function SummaryForm({ callId, summary, sentiment, onDone }: { callId: string; summary: string; sentiment: string | null; onDone?: () => void }) {
  const { state, pending, onSubmit: action } = useFormAction<ActionResult | null>(saveSummary.bind(null, callId) as BoundAction);
  useActionToast(state);
  useOnSuccess(state, () => onDone?.());
  return (
    <form onSubmit={action} className="space-y-3">
      <Field label="Summary" htmlFor="s_summary" hint="Written by a team member. AI summaries arrive in Phase 2.">
        <Textarea id="s_summary" name="summary" rows={5} defaultValue={summary} required maxLength={20000} />
      </Field>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Sentiment" htmlFor="s_sentiment" className="w-44">
          <Select id="s_sentiment" name="sentiment" defaultValue={sentiment ?? ''}>
            <option value="">Not set</option>
            <option value="positive">Positive</option>
            <option value="neutral">Neutral</option>
            <option value="negative">Negative</option>
          </Select>
        </Field>
        <Button type="submit" pending={pending}>
          Save summary
        </Button>
      </div>
    </form>
  );
}

const EXT: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/ogg': 'ogg',
  'audio/webm': 'webm',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
};

function audioDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const a = new Audio();
    a.preload = 'metadata';
    a.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(a.duration) ? a.duration : null);
    };
    a.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    a.src = url;
  });
}

/** Uploads a real audio file straight to the private storage bucket, then registers it. */
export function RecordingUploader({ callId }: { callId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { push } = useToast();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  async function onFile(file: File) {
    setError(null);
    const ext = EXT[file.type];
    if (!ext) return setError('Unsupported file type. Use MP3, WAV, OGG, WEBM, M4A or AAC.');
    if (file.size > 100 * 1024 * 1024) return setError('File is larger than 100 MB.');
    setBusy(true);
    try {
      const duration = await audioDuration(file);
      const path = `calls/${callId}/${crypto.randomUUID()}.${ext}`;
      const supabase = createClient();
      const { error: upErr } = await supabase.storage.from('call-recordings').upload(path, file, { contentType: file.type, upsert: false });
      if (upErr) throw new Error(upErr.message);
      const res = await registerRecording({ callId, path, mimeType: file.type, sizeBytes: file.size, durationSeconds: duration });
      if (!res.ok) {
        await supabase.storage.from('call-recordings').remove([path]);
        throw new Error(res.error);
      }
      push('success', res.message);
      router.refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Upload failed';
      setError(msg);
      push('error', msg);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div className="space-y-2">
      <label className={`inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-line-strong bg-surface px-3 text-sm font-medium hover:bg-canvas ${busy ? 'pointer-events-none opacity-60' : ''}`}>
        <Upload className="size-4" />
        {busy ? 'Uploading…' : 'Upload recording'}
        <input
          ref={inputRef}
          data-testid="recording-input"
          type="file"
          accept="audio/*"
          className="sr-only"
          disabled={busy}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onFile(f);
          }}
        />
      </label>
      <p className="text-xs text-ink-3">Real audio files only (max 100 MB). Stored privately; playback uses short-lived signed links.</p>
      {error && (
        <p className="text-xs text-red-700" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
