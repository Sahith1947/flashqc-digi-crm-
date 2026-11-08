'use client';
import { RefreshCw } from 'lucide-react';
import { ActionButton } from '@/components/config/sarvam-connect';
import { checkCallRecording } from '@/app/(app)/calls/actions';

export function CheckRecordingButton({ callId }: { callId: string }) {
  return <ActionButton action={checkCallRecording.bind(null, callId)} label="Check for recording" testId="check-recording" icon={<RefreshCw className="size-3.5" />} />;
}
