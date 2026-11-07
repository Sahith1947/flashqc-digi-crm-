import 'server-only';
import type { CallOutcome, CallStatus } from '@/lib/constants';

// Generates SIMULATED call results for testing the CRM without telephony.
// Everything produced here is stored with is_simulated = true and is labelled
// "Simulated" throughout the UI. It never produces recordings or transcripts.

export interface SimulatedCall {
  status: CallStatus;
  startedAt: Date;
  answeredAt: Date | null;
  endedAt: Date;
  durationSeconds: number;
  outcome: CallOutcome | null;
  failureReason: string | null;
  events: { type: string; status: CallStatus; at: Date }[];
}

function pick<T>(items: [T, number][], rnd: () => number): T {
  const total = items.reduce((s, [, w]) => s + w, 0);
  let r = rnd() * total;
  for (const [v, w] of items) {
    if ((r -= w) < 0) return v;
  }
  return items[items.length - 1][0];
}

export function simulateCall(direction: 'inbound' | 'outbound', now = new Date(), rnd: () => number = Math.random): SimulatedCall {
  const ringSeconds = 3 + Math.floor(rnd() * 20);
  const status: CallStatus =
    direction === 'inbound'
      ? pick<CallStatus>([['completed', 75], ['missed', 25]], rnd)
      : pick<CallStatus>([['completed', 55], ['no_answer', 25], ['busy', 10], ['failed', 10]], rnd);

  const answered = status === 'completed';
  const talkSeconds = answered ? 20 + Math.floor(rnd() * 280) : 0;
  const endedAt = now;
  const startedAt = new Date(now.getTime() - (ringSeconds + talkSeconds) * 1000);
  const answeredAt = answered ? new Date(startedAt.getTime() + ringSeconds * 1000) : null;

  const outcome: CallOutcome | null = answered
    ? pick<CallOutcome>(
        [
          ['interested', 25],
          ['not_interested', 25],
          ['callback_requested', 20],
          ['converted', 8],
          ['wrong_number', 7],
          ['other', 15],
        ],
        rnd,
      )
    : null;

  const events: SimulatedCall['events'] = [
    { type: 'initiated', status: 'queued', at: startedAt },
    { type: 'ringing', status: 'ringing', at: new Date(startedAt.getTime() + 1000) },
  ];
  if (answered) {
    events.push({ type: 'answered', status: 'in_progress', at: answeredAt! });
  }
  events.push({ type: answered ? 'completed' : status, status, at: endedAt });

  return {
    status,
    startedAt,
    answeredAt,
    endedAt,
    durationSeconds: talkSeconds,
    outcome,
    failureReason: status === 'failed' ? 'Simulated network failure' : null,
    events,
  };
}
