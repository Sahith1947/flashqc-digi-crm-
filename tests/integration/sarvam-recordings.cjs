/* eslint-disable */
// Sarvam call recordings via the Analytics API, against a local fake Sarvam.
// Needs a freshly reset local DB and the app started with SARVAM_ANALYTICS_URL=http://127.0.0.1:4011/api/analytics/v1.
// Usage: npm run test:recordings
const crypto = require('crypto'); const fs = require('fs'); const http = require('http'); const { execSync } = require('child_process'); const { chromium } = require('playwright');
const env = Object.fromEntries(fs.readFileSync(require('path').join(__dirname, '../../.env.local'), 'utf8').split('\n').filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const sql = (q) => execSync(`psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -At -c ${JSON.stringify(q.replace(/\s+/g, ' '))}`, { encoding: 'utf8' }).trim();
const BASE = process.env.BASE_URL || 'http://127.0.0.1:3000';
const ORG = 'org-test-1', WS = 'ws-test-1', APP = 'Conversatio-test-0001', KEY = 'sk_samvaad_test_ABCDEFGHIJKLMNOP1234';
const WEBHOOK_SECRET = Buffer.from(crypto.hkdfSync('sha256', env.INTEGRATION_ENCRYPTION_KEY, 'flashqc-crm', 'sarvam-webhook-v1', 32)).toString('hex');
let pass = 0, fail = 0; const ok = (c, m) => { if (c) { pass++; console.log('  PASS', m); } else { fail++; console.log('  FAIL', m); } };

function encrypt(plain, aad) {
  const key = Buffer.from(env.INTEGRATION_ENCRYPTION_KEY, 'base64'); const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv); c.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
}
function stereoWav(seconds, rate = 11025) {
  const frames = seconds * rate, data = frames * 4, b = Buffer.alloc(44 + data);
  b.write('RIFF', 0); b.writeUInt32LE(36 + data, 4); b.write('WAVE', 8); b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(2, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 4, 28); b.writeUInt16LE(4, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(data, 40);
  for (let i = 0; i < frames; i++) { b.writeInt16LE(800, 44 + i * 4); b.writeInt16LE(-200, 46 + i * 4); }
  return b;
}
const WAV = stereoWav(2);
const hits = [];
const server = http.createServer((req, res) => {
  hits.push(req.url);
  const prefix = `/api/analytics/v1/${ORG}/${WS}/${APP}`;
  if (req.headers['x-api-key'] !== KEY) { res.writeHead(401, { 'Content-Type': 'application/json' }); return res.end('{"detail":"Invalid API key"}'); }
  if (req.url.startsWith(prefix + '/interactions')) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"items":[],"total":0}'); }
  if (req.url.startsWith(prefix + '/recordings/')) {
    const id = decodeURIComponent(req.url.slice((prefix + '/recordings/').length));
    if (/int-a|int-new/.test(id)) { res.writeHead(200, { 'Content-Type': 'audio/wav' }); return res.end(WAV); }
    res.writeHead(404, { 'Content-Type': 'application/json' }); return res.end('{"detail":"Recording not found"}');
  }
  res.writeHead(404); res.end();
});

(async () => {
  await new Promise(r => server.listen(4011, '127.0.0.1', r));
  const r = await fetch('http://127.0.0.1:54321/auth/v1/admin/users', { method: 'POST', headers: { apikey: env.SUPABASE_SECRET_KEY, Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'owner@rec.test', password: 'Passw0rd!rec', email_confirm: true }) });
  ok(r.ok, `admin user created (${r.status})`);
  // Sarvam sign-in (expired on purpose: recordings must not depend on it) and a synced agent + line.
  const jwt = ['e30', Buffer.from(JSON.stringify({ org_id: ORG, workspace_id: WS })).toString('base64url'), 'sig'].join('.');
  const tokens = JSON.stringify({ access_token: jwt, refresh_token: null, expires_at: Date.now() - 3600_000, client_id: 'c1' });
  sql(`insert into integration_credentials (key, ciphertext, metadata) values ('sarvam_ai', '${encrypt(tokens, 'sarvam_ai')}', '{"account_email":"owner@rec.test"}')`);
  sql(`insert into voice_agents (name, provider, provider_agent_id, provider_committed_version, provider_synced_at, connection_status) values ('Sales','sarvam','${APP}',1,now(),'connected')`);
  sql(`insert into phone_numbers (label, phone_e164, provider, provider_connection_id, provider_synced_at, connection_status) values ('Line','+917965482329','vobiz','conn-1',now(),'connected')`);
  const mk = (phone, iid, answered) => {
    const s = new Date(Date.now() - 3600_000).toISOString(), e = new Date(Date.now() - 3500_000).toISOString();
    const id = sql(`insert into calls (direction, status, phone_e164, is_simulated, provider, provider_call_id, started_at, answered_at, ended_at, duration_seconds) values ('inbound','${answered ? 'completed' : 'missed'}','${phone}',false,'sarvam','${iid}','${s}',${answered ? `'${s}'` : 'null'},'${e}',${answered ? 100 : 0}) returning id`).split('\n')[0];
    sql(`insert into call_events (call_id, event_type, status, source, payload) values ('${id}','completed','completed','provider_webhook','{"interaction_id":"${iid}","app_id":"${APP}"}')`);
    return id;
  };
  const callA = mk('+919100000001', '20261108/int-a', true);
  const callB = mk('+919100000002', '20261108/int-b-missing', true);
  const callC = mk('+919100000003', '20261108/int-c', false);

  const b = await chromium.launch(); const p = await b.newPage(); p.setDefaultTimeout(30000);
  const errors = []; p.on('pageerror', x => errors.push(x.message)); p.on('response', x => { if (x.status() >= 500) errors.push(`${x.status()} ${x.url()}`); });
  await p.goto(BASE + '/login'); await p.fill('#email', 'owner@rec.test'); await p.fill('#password', 'Passw0rd!rec');
  await Promise.all([p.waitForURL(u => !u.pathname.startsWith('/login')), p.click('[data-testid=auth-submit]')]);

  await p.goto(BASE + '/integrations'); await p.getByTestId('sarvam-recordings').waitFor();
  ok((await p.getByTestId('sarvam-recordings').innerText()).includes('Off'), 'recordings show Off before the key');
  ok((await p.getByTestId('vobiz-card').count()) === 0, 'Vobiz card hidden (not needed)');
  await p.fill('#sarvam_api_key', 'sk_samvaad_wrong_key_000000000'); await p.getByTestId('sarvam-key-save').click();
  await p.getByText(/Sarvam rejected this API key/).first().waitFor();
  ok(sql(`select count(*) from integration_credentials where key='sarvam_api_key'`) === '0', 'wrong key rejected, nothing stored');
  await p.fill('#sarvam_api_key', KEY); await p.getByTestId('sarvam-key-save').click();
  await p.getByText(/Recordings switched on\. 2 past calls now have a recording/).first().waitFor();
  ok(true, 'right key: recordings switched on, 2 past answered calls marked');
  const stored = sql(`select ciphertext from integration_credentials where key='sarvam_api_key'`);
  ok(stored.startsWith('v1.') && !stored.includes(KEY), 'API key stored encrypted');
  ok(sql(`select count(*) from call_recordings where call_id='${callC}'`) === '0', 'unanswered call gets no recording');
  ok(sql(`select provider_recording_id from call_recordings where call_id='${callA}'`) === `sarvam:${APP}|20261108/int-a`, 'call A references its Sarvam recording');
  await p.goto(BASE + '/integrations');
  ok((await p.getByTestId('sarvam-recordings').innerText()).includes('On') && !(await p.content()).includes(KEY), 'card shows On; key never sent to the browser');

  // Play from Call Logs: first play downloads once, mixes to mono, stores privately.
  await p.goto(BASE + '/calls?q=9100000001'); await p.getByTestId('calls-table').waitFor();
  await p.getByTestId('play-recording').first().click();
  const src = await p.getByTestId('list-recording-player').getAttribute('src');
  const audio = Buffer.from(await (await fetch(src)).arrayBuffer());
  ok(audio.slice(0, 4).toString() === 'RIFF' && audio.readUInt16LE(22) === 1 && audio.length === 44 + (WAV.length - 44) / 2, `plays a mono WAV (${audio.length} bytes, half of ${WAV.length})`);
  const row = sql(`select coalesce(storage_path,'-')||'|'||mime_type||'|'||duration_seconds||'|'||size_bytes from call_recordings where call_id='${callA}'`);
  ok(/^calls\/[0-9a-f-]+\/[0-9a-f-]{36}\.wav\|audio\/wav\|2\|\d+$/.test(row), `stored privately: ${row}`);
  const downloads = () => hits.filter(h => h.includes('/recordings/') && h.includes('int-a')).length;
  ok(downloads() === 1, 'downloaded from Sarvam once');
  await p.goto(BASE + `/calls/${callA}`); await p.locator('audio').first().waitFor();
  ok(downloads() === 1, 'call page plays the saved copy (no second download)');
  // Call B: Sarvam has none -> clear message, reference removed.
  await p.goto(BASE + '/calls?q=9100000002'); await p.getByTestId('play-recording').first().click();
  await p.getByText('Sarvam has no recording for this call.').first().waitFor();
  ok(sql(`select count(*) from call_recordings where call_id='${callB}'`) === '0', 'missing recording: clear message, reference removed');

  // A new inbound call arriving by webhook gets its recording automatically.
  const wh = await fetch(BASE + '/api/webhooks/telephony/sarvam', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deployment_id: 'dep-1', app_id: APP, app_version: 1, interaction_id: '20261108/int-new', user_phone_number: '+919100000009', agent_phone_number: '+917965482329', duration: 40, start_datetime: new Date(Date.now() - 60_000).toISOString(), end_datetime: new Date().toISOString(), interaction_transcript: [{ role: 'user', en_text: 'Yes I am interested' }], final_agent_variables: { consultation_outcome: 'whatsapp_details_requested', lead_temperature: 'WARM' }, metadata: { crm_secret: WEBHOOK_SECRET } }) });
  ok(wh.ok && sql(`select count(*) from call_recordings r join calls c on c.id=r.call_id where c.provider_call_id='20261108/int-new'`) === '1', `new webhook call gets a recording automatically (${wh.status})`);
  // Remove key: deleted, saved recordings stay.
  await p.goto(BASE + '/integrations'); await p.locator('[data-testid=sarvam-recordings] summary').click();
  await p.getByTestId('sarvam-key-remove').click(); await p.getByText(/Sarvam API key deleted/).first().waitFor();
  ok(sql(`select count(*) from integration_credentials where key='sarvam_api_key'`) === '0' && sql(`select count(*) from call_recordings where call_id='${callA}'`) === '1', 'remove key: key deleted, saved recording stays');
  ok(errors.length === 0, `no page errors / 5xx (${errors.join('; ')})`);
  await b.close(); server.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); server.close(); process.exit(1); });
