'use client';
import { useEffect } from 'react';
import { RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ErrorNotice } from '@/components/ui/states';

export default function AppError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  const digest = error instanceof Error && 'digest' in error ? String((error as { digest?: string }).digest ?? '') : '';
  return (
    <div className="mx-auto max-w-xl space-y-4 py-12">
      <ErrorNotice title="This page failed to load" message={digest ? `Reference: ${digest}` : 'An unexpected error occurred.'} />
      <Button variant="secondary" icon={<RotateCcw className="size-4" />} onClick={() => retry()}>
        Try again
      </Button>
    </div>
  );
}
