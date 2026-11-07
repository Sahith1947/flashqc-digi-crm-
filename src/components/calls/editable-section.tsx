'use client';
import { useState, type ReactNode } from 'react';
import { Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SummaryForm, TranscriptForm } from './call-detail-forms';

export type EditorSpec =
  | { type: 'transcript'; callId: string; content: string; language: string | null }
  | { type: 'summary'; callId: string; summary: string; sentiment: string | null };

/** Shows content with an Edit toggle that swaps in the matching form. Props are serialisable (Server → Client safe). */
export function EditableSection({ view, editor, canEdit, emptyLabel, hasContent }: { view: ReactNode; editor: EditorSpec; canEdit: boolean; emptyLabel: string; hasContent: boolean }) {
  const [editing, setEditing] = useState(false);
  const done = () => setEditing(false);
  if (editing) {
    return (
      <div className="space-y-3">
        {editor.type === 'transcript' ? (
          <TranscriptForm callId={editor.callId} content={editor.content} language={editor.language} onDone={done} />
        ) : (
          <SummaryForm callId={editor.callId} summary={editor.summary} sentiment={editor.sentiment} onDone={done} />
        )}
        <Button variant="ghost" size="sm" onClick={done}>
          Cancel
        </Button>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {hasContent ? view : <p className="text-sm text-ink-3">{emptyLabel}</p>}
      {canEdit && (
        <Button variant="secondary" size="sm" icon={<Pencil className="size-3.5" />} onClick={() => setEditing(true)}>
          {hasContent ? 'Edit' : 'Add manually'}
        </Button>
      )}
    </div>
  );
}
