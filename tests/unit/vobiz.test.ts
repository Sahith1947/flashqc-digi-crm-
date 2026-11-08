import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchRecording, normalizeRecording, parseVobizTime } from '../../src/lib/vobiz.ts';

test('parseVobizTime handles epoch, zoned and India-local strings', () => {
  assert.equal(parseVobizTime(1762578247), 1762578247000);
  assert.equal(parseVobizTime('1762578247123'), 1762578247123);
  assert.equal(parseVobizTime('2026-11-08 10:34:07.123456+05:30'), Date.parse('2026-11-08T05:04:07.123Z'));
  assert.equal(parseVobizTime('2026-11-08 10:34:07'), Date.parse('2026-11-08T05:04:07Z')); // no zone = IST
  assert.equal(parseVobizTime(''), null);
  assert.equal(parseVobizTime('nonsense'), null);
});

test('normalizeRecording reads ids, numbers, time and duration', () => {
  const r = normalizeRecording({
    recording_id: 'rec123',
    recording_url: 'https://media.vobiz.ai/rec123.mp3',
    call_uuid: 'abc',
    from_number: '+917893468393',
    to_number: '917965482329',
    add_time: '2026-11-08 10:34:07+05:30',
    recording_duration_ms: '102600',
    recording_format: 'MP3',
  });
  assert.ok(r);
  assert.deepEqual(r.numbers.sort(), ['7893468393', '7965482329']);
  assert.equal(r.durationSeconds, 103);
  assert.equal(r.format, 'mp3');
  assert.equal(r.at, Date.parse('2026-11-08T05:04:07Z'));
  assert.equal(normalizeRecording({ recording_id: 'x', recording_url: 'http://insecure' }), null);
  assert.equal(normalizeRecording({ recording_url: 'https://a/b.mp3' }), null);
});

test('matchRecording picks the closest call with the same customer number within 10 minutes', () => {
  const at = Date.parse('2026-11-08T05:04:07Z');
  const rec = { id: 'r', url: 'https://x', callUuid: null, numbers: ['7893468393', '7965482329'], at, durationSeconds: 100, format: 'mp3' };
  const calls = [
    { id: 'far', phone: '+917893468393', startedAt: at - 60 * 60_000, endedAt: at - 58 * 60_000 },
    { id: 'near', phone: '+917893468393', startedAt: at - 30_000, endedAt: at + 70_000 },
    { id: 'other', phone: '+919999999999', startedAt: at, endedAt: at },
  ];
  assert.equal(matchRecording(rec, calls)?.id, 'near');
  assert.equal(matchRecording({ ...rec, at: at + 3 * 3600_000 }, calls), null);
  assert.equal(matchRecording({ ...rec, numbers: ['1111111111'] }, calls), null);
});
