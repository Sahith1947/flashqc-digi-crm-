// Lead pipeline and emotion detection. Pure module (no imports) so it can be unit-tested.

export const LEAD_STAGES = ['new', 'contacted', 'interested', 'callback', 'meeting_booked', 'won', 'lost'] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];

export const LEAD_STAGE_LABELS: Record<LeadStage, string> = {
  new: 'New',
  contacted: 'Contacted',
  interested: 'Interested',
  callback: 'Callback',
  meeting_booked: 'Meeting booked',
  won: 'Won',
  lost: 'Lost',
};

export const LEAD_STAGE_TONE: Record<LeadStage, 'neutral' | 'info' | 'brand' | 'warning' | 'good' | 'critical'> = {
  new: 'neutral',
  contacted: 'info',
  interested: 'brand',
  callback: 'warning',
  meeting_booked: 'good',
  won: 'good',
  lost: 'critical',
};

export const LEAD_TEMPERATURES = ['hot', 'warm', 'cold'] as const;
export type LeadTemperature = (typeof LEAD_TEMPERATURES)[number];

const RANK: Record<LeadStage, number> = { new: 0, contacted: 1, interested: 2, callback: 3, meeting_booked: 4, won: 5, lost: -1 };

/** Stage the AI call analysis points to, or null when the call says nothing about it. */
export function stageFromCall(input: { connected: boolean; outcome?: string | null; temperature?: string | null }): LeadStage | null {
  if (!input.connected) return null;
  const t = (input.temperature ?? '').toLowerCase();
  switch ((input.outcome ?? '').toLowerCase()) {
    case 'meeting_booked':
      return 'meeting_booked';
    case 'callback_requested':
      return 'callback';
    case 'whatsapp_details_requested':
      return 'interested';
    case 'not_interested':
      return 'lost';
    case 'no_booking':
      return t === 'hot' || t === 'warm' ? 'interested' : 'contacted';
    default:
      return t === 'hot' ? 'interested' : 'contacted';
  }
}

/**
 * Decides the contact's next stage. Leads only move forward automatically; "won" is never
 * changed by a call; "lost" is applied only before a meeting is booked; a lost lead that
 * shows new interest is re-opened.
 */
export function nextStage(current: LeadStage, suggested: LeadStage | null): LeadStage {
  if (!suggested || current === 'won') return current;
  if (suggested === 'lost') return RANK[current] < RANK.meeting_booked ? 'lost' : current;
  if (current === 'lost') return RANK[suggested] >= RANK.interested ? suggested : current;
  return RANK[suggested] > RANK[current] ? suggested : current;
}

export interface Emotion {
  label: string;
  sentiment: 'positive' | 'neutral' | 'negative';
  reason: string;
}

const ANNOYED = ['angry', 'irritat', 'disturb', 'stop calling', "don't call", 'dont call', 'do not call', 'waste of time', 'fraud', 'spam', 'nonsense', 'harass', 'not interested at all'];
const CONFUSED = ['confus', "don't understand", 'dont understand', 'not clear', 'what is this', 'who is this', 'which company'];
const POSITIVE = ['great', 'super', 'sounds good', 'perfect', 'interested', 'yes please', 'happy', 'awesome', 'nice', 'definitely', 'sure,'];

/**
 * Auto-detected caller emotion. Uses the agent's post-call analysis (lead temperature, outcome)
 * and the customer's own words in the transcript (English text of each turn).
 */
export function detectEmotion(input: { connected: boolean; temperature?: string | null; outcome?: string | null; customerText?: string }): Emotion | null {
  if (!input.connected) return null;
  const text = (input.customerText ?? '').toLowerCase();
  const has = (words: string[]) => words.some((w) => text.includes(w));
  const t = (input.temperature ?? '').toLowerCase();
  const outcome = (input.outcome ?? '').toLowerCase();
  if (has(ANNOYED)) return { label: 'Annoyed', sentiment: 'negative', reason: 'Customer used frustrated or do-not-call language' };
  if (outcome === 'meeting_booked' || t === 'hot') return { label: 'Excited', sentiment: 'positive', reason: t === 'hot' ? 'AI rated the lead HOT' : 'Meeting booked' };
  if (has(CONFUSED)) return { label: 'Confused', sentiment: 'neutral', reason: 'Customer asked for clarification' };
  if (t === 'warm' || outcome === 'callback_requested' || outcome === 'whatsapp_details_requested' || has(POSITIVE))
    return { label: 'Interested', sentiment: 'positive', reason: t === 'warm' ? 'AI rated the lead WARM' : 'Customer showed interest' };
  if (t === 'cold' || outcome === 'not_interested') return { label: 'Disinterested', sentiment: 'negative', reason: t === 'cold' ? 'AI rated the lead COLD' : 'Not interested' };
  return { label: 'Neutral', sentiment: 'neutral', reason: 'No strong signal in the conversation' };
}

export function emotionTone(label: string | null | undefined): 'good' | 'neutral' | 'warning' | 'critical' | 'info' {
  switch (label) {
    case 'Excited':
    case 'Interested':
      return 'good';
    case 'Annoyed':
      return 'critical';
    case 'Disinterested':
      return 'warning';
    case 'Confused':
      return 'info';
    default:
      return 'neutral';
  }
}

// ---- Interest (one simple word per call; mirrors public.call_interest in the database) ----
export const INTERESTS = ['interested', 'callback', 'confused', 'not_interested', 'hung_up', 'no_answer', 'unclear'] as const;
export type Interest = (typeof INTERESTS)[number];
export const INTEREST_LABELS: Record<Interest | 'pending' | 'skipped', string> = {
  interested: 'Interested',
  callback: 'Callback',
  confused: 'Confused',
  not_interested: 'Not interested',
  hung_up: 'Hung up early',
  no_answer: 'No answer',
  unclear: 'Needs review',
  pending: 'Not called yet',
  skipped: 'Skipped (DND / no consent)',
};
export const INTEREST_TONE: Record<Interest | 'pending' | 'skipped', 'good' | 'warning' | 'info' | 'critical' | 'neutral'> = {
  interested: 'good',
  callback: 'warning',
  confused: 'info',
  not_interested: 'critical',
  hung_up: 'warning',
  no_answer: 'neutral',
  unclear: 'neutral',
  pending: 'neutral',
  skipped: 'neutral',
};

export function interestOf(input: { answered: boolean; outcome?: string | null; emotion?: string | null; durationSeconds?: number | null }): Interest {
  if (!input.answered) return 'no_answer';
  const o = input.outcome ?? '';
  if (o === 'callback_requested') return 'callback';
  if (o === 'converted' || o === 'interested') return 'interested';
  if (o === 'not_interested' || o === 'do_not_call' || o === 'wrong_number') return 'not_interested';
  if (input.emotion === 'Confused') return 'confused';
  if (input.emotion === 'Excited' || input.emotion === 'Interested') return 'interested';
  if (input.emotion === 'Disinterested' || input.emotion === 'Annoyed') return 'not_interested';
  if ((input.durationSeconds ?? 0) <= 12) return 'hung_up';
  return 'unclear';
}
