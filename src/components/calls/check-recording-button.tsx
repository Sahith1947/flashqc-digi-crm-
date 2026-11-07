'use client';
import { RefreshCw } from 'lucide-react';
import { ActionButton } from '@/components/config/sarvam-connect';
import { checkSarvamRecording } from '@/app/(app)/calls/actions';

export function CheckRecordingButton({ callId }: { callId: string }) {
  return <ActionButton action={checkSarvamRecording.bind(null, callId)} label="Check Sarvam for recording" testId="check-recording" icon={<RefreshCw className="size-3.5" />} />;
}
