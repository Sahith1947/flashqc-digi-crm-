import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePhone, formatPhone } from '../../src/lib/phone.ts';
import { parseCsv, toCsv, escapeCsvCell } from '../../src/lib/csv.ts';
import { buildImportPreview, mapHeaders } from '../../src/lib/contact-import.ts';
import { resolveRange, istDateString, formatDuration, isWithinWindow, istTimeOfDay, formatDateTime } from '../../src/lib/dates.ts';

test('normalizePhone: Indian formats', () => {
  for (const v of ['9876543210', '09876543210', '919876543210', '+91 98765-43210', '0091 98765 43210', '(+91) 98765.43210']) {
    assert.deepEqual(normalizePhone(v), { ok: true, e164: '+919876543210' }, v);
  }
});
test('normalizePhone: international and invalid', () => {
  assert.deepEqual(normalizePhone('+1 415 555 2671'), { ok: true, e164: '+14155552671' });
  for (const v of ['', '12345', 'abc', '+91 0876543210', '+9198765', '9.19876543210E+11', '+0123456789', '98765 4321x']) {
    assert.equal(normalizePhone(v).ok, false, v);
  }
  assert.equal(formatPhone('+919876543210'), '+91 98765 43210');
});

test('parseCsv: quotes, escaped quotes, CRLF, BOM, blank lines', () => {
  const rows = parseCsv('﻿name,notes\r\n"Doe, John","He said ""hi"""\r\n\r\nAmy,"line1\nline2"\n');
  assert.deepEqual(rows, [['name', 'notes'], ['Doe, John', 'He said "hi"'], ['Amy', 'line1\nline2']]);
});
test('toCsv round-trip and formula injection guard', () => {
  assert.equal(escapeCsvCell('=SUM(A1)'), "'=SUM(A1)");
  assert.equal(escapeCsvCell('@cmd'), "'@cmd");
  assert.equal(escapeCsvCell('-x'), "'-x");
  assert.equal(escapeCsvCell('+919876543210'), '+919876543210');
  const csv = toCsv(['a', 'b'], [['x,y', 'q"z'], [null, 5]]);
  assert.deepEqual(parseCsv(csv), [['a', 'b'], ['x,y', 'q"z'], ['', '5']]);
});

test('mapHeaders detects aliases', () => {
  const m = mapHeaders(['Contact Name', 'Mobile Number', 'Company', 'Industry', 'City', 'DND']);
  assert.equal(m.full_name, 'Contact Name');
  assert.equal(m.phone, 'Mobile Number');
  assert.equal(m.business_name, 'Company');
  assert.equal(m.business_category, 'Industry');
  assert.equal(m.dnd_status, 'DND');
});
test('buildImportPreview validates and dedupes', () => {
  const p = buildImportPreview('name,phone,consent\nA,9876543210,yes\nB,+91 98765 43210,\nC,123,\nD,9123456789,maybe\nE,9123456780,no\n');
  assert.equal(p.fatal, null);
  assert.deepEqual(p.counts, { total: 5, valid: 2, invalid: 2, duplicates: 1 });
  assert.equal(p.rows[0].contact?.consent_status, 'granted');
  assert.equal(p.rows[1].status, 'duplicate_in_file');
  assert.equal(p.rows[4].contact?.consent_status, 'revoked');
  assert.equal(p.rows[0].contact?.source, 'csv_import');
  assert.ok(buildImportPreview('name,city\nA,B\n').fatal?.includes('phone'));
  assert.ok(buildImportPreview('').fatal);
});

test('dates: IST boundaries', () => {
  const now = new Date('2026-11-07T20:00:00Z'); // 01:30 IST on 8 Nov
  assert.equal(istDateString(now), '2026-11-08');
  const r = resolveRange({ range: 'today' }, '30d', now);
  assert.equal(r.from.toISOString(), '2026-11-07T18:30:00.000Z');
  assert.equal(r.to.toISOString(), '2026-11-08T18:30:00.000Z');
  const r7 = resolveRange({ range: '7d' }, '30d', now);
  assert.equal(r7.fromDate, '2026-11-02');
  const c = resolveRange({ range: 'custom', from: '2026-10-01', to: '2026-10-31' }, '30d', now);
  assert.equal(c.fromDate, '2026-10-01');
  const bad = resolveRange({ range: 'custom', from: 'bad', to: '2026-10-31' }, '30d', now);
  assert.equal(bad.preset, 'custom');
  assert.equal(bad.fromDate, '2026-10-10');
  assert.equal(resolveRange({ range: 'custom', from: '2026-10-31', to: '2026-10-01' }, '30d', now).fromDate, '2026-10-10');
  assert.equal(resolveRange({ range: 'nonsense' }, '7d', now).preset, '7d');
  assert.equal(resolveRange({ range: 'month' }, '30d', now).fromDate, '2026-11-01');
  assert.equal(istTimeOfDay(now), '01:30');
  assert.ok(isWithinWindow('09:00', '09:00:00', '21:00:00'));
  assert.ok(!isWithinWindow('21:00', '09:00', '21:00'));
  assert.match(formatDateTime('2026-11-07T20:00:00Z'), /08 Nov 2026/);
});
test('formatDuration', () => {
  assert.equal(formatDuration(45), '45s');
  assert.equal(formatDuration(125), '2m 05s');
  assert.equal(formatDuration(3725), '1h 02m');
  assert.equal(formatDuration(null), '0s');
});
