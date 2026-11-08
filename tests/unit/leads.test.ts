import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectEmotion, nextStage, stageFromCall } from '../../src/lib/leads.ts';

test('stageFromCall maps Sarvam outcomes', () => {
  assert.equal(stageFromCall({ connected: true, outcome: 'meeting_booked' }), 'meeting_booked');
  assert.equal(stageFromCall({ connected: true, outcome: 'callback_requested' }), 'callback');
  assert.equal(stageFromCall({ connected: true, outcome: 'whatsapp_details_requested' }), 'interested');
  assert.equal(stageFromCall({ connected: true, outcome: 'not_interested' }), 'lost');
  assert.equal(stageFromCall({ connected: true, outcome: 'no_booking', temperature: 'HOT' }), 'interested');
  assert.equal(stageFromCall({ connected: true, outcome: 'no_booking', temperature: 'COLD' }), 'contacted');
  assert.equal(stageFromCall({ connected: false, outcome: 'meeting_booked' }), null);
});

test('nextStage only moves forward and protects won/meeting', () => {
  assert.equal(nextStage('new', 'contacted'), 'contacted');
  assert.equal(nextStage('meeting_booked', 'contacted'), 'meeting_booked');
  assert.equal(nextStage('interested', 'lost'), 'lost');
  assert.equal(nextStage('meeting_booked', 'lost'), 'meeting_booked');
  assert.equal(nextStage('won', 'lost'), 'won');
  assert.equal(nextStage('won', 'meeting_booked'), 'won');
  assert.equal(nextStage('lost', 'contacted'), 'lost');
  assert.equal(nextStage('lost', 'interested'), 'interested');
  assert.equal(nextStage('callback', null), 'callback');
});

test('detectEmotion', () => {
  assert.equal(detectEmotion({ connected: true, temperature: 'HOT' })?.label, 'Excited');
  assert.equal(detectEmotion({ connected: true, temperature: 'WARM' })?.label, 'Interested');
  assert.equal(detectEmotion({ connected: true, temperature: 'COLD' })?.sentiment, 'negative');
  assert.equal(detectEmotion({ connected: true, temperature: 'HOT', customerText: 'Please stop calling me' })?.label, 'Annoyed');
  assert.equal(detectEmotion({ connected: true, customerText: 'I dont understand, which company?' })?.label, 'Confused');
  assert.equal(detectEmotion({ connected: true })?.label, 'Neutral');
  assert.equal(detectEmotion({ connected: false, temperature: 'HOT' }), null);
});

import { interestOf } from '../../src/lib/leads.ts';
test('interestOf gives one simple word per call', () => {
  assert.equal(interestOf({ answered: false, outcome: 'interested' }), 'no_answer');
  assert.equal(interestOf({ answered: true, outcome: 'callback_requested', emotion: 'Annoyed' }), 'callback');
  assert.equal(interestOf({ answered: true, outcome: 'converted' }), 'interested');
  assert.equal(interestOf({ answered: true, outcome: 'not_interested', emotion: 'Excited' }), 'not_interested');
  assert.equal(interestOf({ answered: true, outcome: 'other', emotion: 'Confused' }), 'confused');
  assert.equal(interestOf({ answered: true, outcome: 'other', emotion: 'Disinterested' }), 'not_interested');
  assert.equal(interestOf({ answered: true, outcome: null, emotion: 'Neutral', durationSeconds: 60 }), 'unclear');
  assert.equal(interestOf({ answered: true, outcome: null, emotion: null, durationSeconds: 7 }), 'hung_up');
});
