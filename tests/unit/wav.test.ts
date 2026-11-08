import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWav, stereoToMono, wavDurationSeconds } from '../../src/lib/wav.ts';

function stereoWav(frames: number, rate = 11025): Uint8Array {
  const data = frames * 4;
  const b = new Uint8Array(44 + data);
  const v = new DataView(b.buffer);
  const put = (o: number, s: string) => [...s].forEach((c, i) => (b[o + i] = c.charCodeAt(0)));
  put(0, 'RIFF'); v.setUint32(4, 36 + data, true); put(8, 'WAVE'); put(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true); v.setUint32(24, rate, true);
  v.setUint32(28, rate * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true); put(36, 'data'); v.setUint32(40, data, true);
  for (let i = 0; i < frames; i++) { v.setInt16(44 + i * 4, 1000, true); v.setInt16(46 + i * 4, i === 0 ? 32000 : -400, true); }
  return b;
}

test('parseWav and duration read Sarvam-style stereo PCM', () => {
  const w = stereoWav(11025 * 2);
  const info = parseWav(w)!;
  assert.equal(info.channels, 2);
  assert.equal(info.sampleRate, 11025);
  assert.equal(wavDurationSeconds(w), 2);
  assert.equal(parseWav(new Uint8Array(10)), null);
  assert.equal(parseWav(new TextEncoder().encode('not a wav file at all, definitely not RIFF....')), null);
});

test('stereoToMono halves the size, keeps duration and mixes both voices', () => {
  const w = stereoWav(11025);
  const m = stereoToMono(w);
  assert.equal(m.length, 44 + 11025 * 2);
  assert.equal(parseWav(m)!.channels, 1);
  assert.equal(wavDurationSeconds(m), 1);
  const v = new DataView(m.buffer);
  assert.equal(v.getInt16(44, true), 32767); // 1000 + 32000 clipped
  assert.equal(v.getInt16(46, true), 600); // 1000 + (-400)
  const notWav = new Uint8Array([1, 2, 3]);
  assert.equal(stereoToMono(notWav), notWav);
});
