/* eslint-disable */
// Vobiz call-recording sync against a local fake Vobiz API.
// Needs a freshly reset local DB and the app started with VOBIZ_BASE_URL=http://127.0.0.1:4010.
// Usage: npm run test:vobiz
const fs = require('fs'); const http = require('http'); const { execSync } = require('child_process'); const { chromium } = require('playwright');
const env = Object.fromEntries(fs.readFileSync(require('path').join(__dirname, '../../.env.local'), 'utf8').split('\n').filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const sql = (q) => execSync(`psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -At -c ${JSON.stringify(q.replace(/\s+/g, ' '))}`, { encoding: 'utf8' }).trim();
const BASE = process.env.BASE_URL || 'http://127.0.0.1:3000';
const AUTH_ID = 'MA_TEST1234', TOKEN = 'tok_secret_vobiz_987654';
let pass = 0, fail = 0; const ok = (c, m) => { if (c) { pass++; console.log('  PASS', m); } else { fail++; console.log('  FAIL', m); } };

// A tiny valid MP3 frame repeated (enough for storage + content-type checks).
const MP3 = Buffer.concat(Array(40).fill(Buffer.from('fffb9064000000000000000000000000000000000000000000000000000000000000', 'hex')));
const now = Date.now();
const ist = (ms) => new Date(ms + 5.5 * 3600_000).toISOString().replace('T', ' ').slice(0, 19) + '+05:30';
const callStart = now - 2 * 3600_000;
let requests = [];
const recordings = [
  { recording_id: 'rec-match', recording_url: 'http://127.0.0.1:4010/audio/rec-match.mp3', call_uuid: 'u1', from_number: '+917893468393', to_number: '+917965482329', add_time: ist(callStart + 105_000), recording_duration_ms: '102600', recording_format: 'mp3' },
  { recording_id: 'rec-other', recording_url: 'http://127.0.0.1:4010/audio/rec-other.mp3', call_uuid: 'u2', from_number: '+919000000001', to_number: '+917965482329', add_time: ist(callStart), recording_duration_ms: '5000', recording_format: 'mp3' },
];
const server = http.createServer((req, res) => {
  requests.push({ url: req.url, id: req.headers['x-auth-id'], token: req.headers['x-auth-token'] });
  if (req.url.startsWith('/audio/')) { res.writeHead(200, { 'Content-Type': 'audio/mpeg' }); return res.end(MP3); }
  if (req.headers['x-auth-id'] !== AUTH_ID || req.headers['x-auth-token'] !== TOKEN) { res.writeHead(401, { 'Content-Type': 'application/json' }); return res.end('{"error":"unauthorized"}'); }
  if (req.url.startsWith(`/api/v1/Account/${AUTH_ID}/Recording/`)) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ meta: { total_count: recordings.length }, objects: recordings })); }
  if (req.url.startsWith(`/api/v1/Account/${AUTH_ID}/trunks/`)) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ objects: [{ trunk_id: 't1', recording: true }] })); }
  res.writeHead(404); res.end();
});

(async () => {
  await new Promise(r => server.listen(4010, '127.0.0.1', r));
  // Admin user (first signup becomes admin) and one answered real call from +917893468393.
  const r = await fetch('http://127.0.0.1:54321/auth/v1/admin/users', { method: 'POST', headers: { apikey: env.SUPABASE_SECRET_KEY, Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'owner@vobiz.test', password: 'Passw0rd!vobiz', email_confirm: true, user_metadata: { full_name: 'Owner' } }) });
  ok(r.ok, `admin user created (${r.status})`);
  const s = new Date(callStart).toISOString(), e = new Date(callStart + 102_000).toISOString();
  const callId = sql(`insert into calls (direction, status, phone_e164, is_simulated, provider, provider_call_id, started_at, answered_at, ended_at, duration_seconds) values ('inbound','completed','+917893468393',false,'sarvam','int-vobiz-1','${s}','${s}','${e}',102) returning id`).split('\n')[0];
  const lonely = sql(`insert into calls (direction, status, phone_e164, is_simulated, provider, provider_call_id, started_at, answered_at, ended_at, duration_seconds) values ('inbound','completed','+918888888888',false,'sarvam','int-vobiz-2','${s}','${s}','${e}',50) returning id`).split('\n')[0];

  const b = await chromium.launch(); const p = await b.newPage(); p.setDefaultTimeout(30000);
  const errors = []; p.on('pageerror', x => errors.push(x.message)); p.on('response', x => { if (x.status() >= 500) errors.push(`${x.status()} ${x.url()}`); });
  await p.goto(BASE + '/login'); await p.fill('#email', 'owner@vobiz.test'); await p.fill('#password', 'Passw0rd!vobiz');
  await Promise.all([p.waitForURL(u => !u.pathname.startsWith('/login')), p.click('[data-testid=auth-submit]')]);

  // Before connecting: Call Logs explain how to get recordings.
  await p.goto(BASE + '/integrations?vobiz=1'); await p.getByTestId('vobiz-card').waitFor();
  ok((await p.getByTestId('vobiz-card').innerText()).includes('Not connected'), 'Vobiz card shows Not connected');
  // Wrong token is refused and nothing is stored.
  await p.fill('#vobiz_auth_id', AUTH_ID); await p.fill('#vobiz_auth_token', 'wrong-token-123');
  await p.getByTestId('vobiz-connect').click();
  await p.getByText(/Vobiz rejected these keys/).first().waitFor();
  ok(sql(`select count(*) from integration_credentials where key='vobiz'`) === '0', 'wrong keys rejected, nothing stored');
  // Right keys: connected and first sync attaches the matching recording.
  await p.fill('#vobiz_auth_id', AUTH_ID); await p.fill('#vobiz_auth_token', TOKEN);
  await p.getByTestId('vobiz-connect').click();
  await p.getByText(/Vobiz connected.*1 recording added/).first().waitFor();
  ok(true, 'connected; first sync reports 1 recording added');
  const stored = sql(`select ciphertext from integration_credentials where key='vobiz'`);
  ok(stored.startsWith('v1.') && !stored.includes(TOKEN) && !stored.includes(AUTH_ID), 'keys stored encrypted (no plain token or id)');
  ok(requests.some(q => q.url.includes('/Recording/') && q.id === AUTH_ID && q.token === TOKEN), 'Vobiz called with X-Auth-ID / X-Auth-Token');
  const rec = sql(`select provider_recording_id||'|'||coalesce(storage_path,'-')||'|'||coalesce(mime_type,'-')||'|'||coalesce(duration_seconds::text,'-')||'|'||(provider_recording_url is null) from call_recordings where call_id='${callId}'`);
  ok(/^vobiz:rec-match\|calls\/[0-9a-f-]+\/[0-9a-f-]{36}\.mp3\|audio\/mpeg\|103\|true$/.test(rec), `audio saved privately: ${rec}`);
  ok(sql(`select count(*) from storage.objects where bucket_id='call-recordings' and name like 'calls/${callId}/%'`) === '1', 'audio file is in private storage');
  ok(sql(`select count(*) from call_recordings where call_id='${lonely}'`) === '0', 'call with no matching recording gets none');
  ok(sql(`select count(*) from call_recordings where provider_recording_id='vobiz:rec-other'`) === '0', 'recording of an unknown number is not attached');
  await p.goto(BASE + '/integrations');
  const card = await p.getByTestId('vobiz-card').innerText();
  ok(card.includes('Connected') && card.includes('MA_T') && !card.includes(TOKEN) && (await p.getByTestId('vobiz-attached').innerText()) === '1', 'card shows Connected, masked account, 1 recording, never the token');
  ok(!(await p.content()).includes(TOKEN), 'token never sent to the browser');

  // Call Logs: Play button streams the stored audio.
  await p.goto(BASE + '/calls'); await p.getByTestId('calls-table').waitFor();
  await p.getByTestId('play-recording').first().click();
  const src = await p.getByTestId('list-recording-player').getAttribute('src');
  const audio = await fetch(src); const buf = Buffer.from(await audio.arrayBuffer());
  ok(audio.ok && buf.length === MP3.length, `Play button streams the recording (${audio.status}, ${buf.length} bytes)`);

  // Sync again: idempotent.
  await p.goto(BASE + '/integrations'); await p.getByTestId('vobiz-sync').click();
  await p.getByText(/no new recordings/).first().waitFor();
  ok(sql(`select count(*) from call_recordings`) === '1', 'second sync adds no duplicates');
  // Cron endpoint also runs the sync.
  const cron = await fetch(BASE + '/api/cron/campaigns', { headers: { Authorization: `Bearer ${env.CRON_SECRET}` } });
  const cj = await cron.json();
  ok(cron.ok && cj.recordings === 0, `cron runs recording sync (${JSON.stringify(cj.recordings)})`);
  // Call page "Check for recording" on a call Vobiz has nothing for explains why.
  await p.goto(BASE + `/calls/${lonely}`); await p.getByTestId('check-recording').click();
  await p.getByText(/Vobiz has no recording for this call yet/).first().waitFor();
  ok(true, 'check button explains missing Vobiz recording');
  // Disconnect deletes the keys; recordings stay.
  await p.goto(BASE + '/integrations'); await p.getByTestId('vobiz-disconnect').click();
  await p.getByText(/Vobiz disconnected/).first().waitFor();
  ok(sql(`select count(*) from integration_credentials where key='vobiz'`) === '0' && sql(`select count(*) from call_recordings`) === '1', 'disconnect deletes keys, keeps recordings');
  ok(errors.length === 0, `no page errors / 5xx (${errors.join('; ')})`);
  await b.close(); server.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); server.close(); process.exit(1); });
