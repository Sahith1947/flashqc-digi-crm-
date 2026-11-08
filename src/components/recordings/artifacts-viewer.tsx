'use client';
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { Badge } from '@/components/ui/badge';
import { getCallArtifacts } from '@/app/(app)/recordings/actions';

type Artifacts = Awaited<ReturnType<typeof getCallArtifacts>>;

export function ArtifactsViewer({ callId, title, hasTranscript, hasSummary }: { callId: string; title: string; hasTranscript: boolean; hasSummary: boolean }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Artifacts | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, start] = useTransition();
  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        icon={<FileText className="size-3.5" />}
        onClick={() => {
          setOpen(true);
          if (!data)
            start(async () => {
              try {
                setData(await getCallArtifacts(callId));
              } catch {
                setFailed(true);
              }
            });
        }}
        data-testid="view-artifacts"
      >
        Transcript & summary
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title={title} wide>
        {pending && <p className="text-sm text-ink-3">Loading…</p>}
        {failed && <p className="text-sm text-red-700">Could not load the transcript and summary.</p>}
        {data && (
          <div className="space-y-5">
            <section>
              <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
                AI summary {data.summary && <Badge tone="neutral" icon={false}>{data.summary.source === 'ai' ? `AI${data.summary.model ? ` · ${data.summary.model}` : ''}` : 'Manual'}</Badge>}
              </h3>
              {data.summary ? <p className="text-sm whitespace-pre-wrap">{data.summary.summary}</p> : <p className="text-sm text-ink-3">{hasSummary ? 'Summary unavailable.' : 'No summary yet. It appears automatically after an answered Sarvam call.'}</p>}
            </section>
            <section>
              <h3 className="mb-2 text-sm font-semibold">Transcript</h3>
              {data.transcript ? (
                <pre className="max-h-96 overflow-auto rounded-lg bg-canvas p-3 font-sans text-sm whitespace-pre-wrap">{data.transcript.content}</pre>
              ) : (
                <p className="text-sm text-ink-3">{hasTranscript ? 'Transcript unavailable.' : 'No transcript yet.'}</p>
              )}
            </section>
            <Link href={`/calls/${callId}`} className="inline-block text-sm font-medium text-brand-700 hover:underline">
              Open call details to edit
            </Link>
          </div>
        )}
      </Modal>
    </>
  );
}
