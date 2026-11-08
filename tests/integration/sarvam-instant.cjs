/* eslint-disable */
// Live calls dial instantly through Sarvam's instant-outbound API (no campaign start delay), against a local fake.
// Needs a freshly reset local DB and the app started with APP_URL=http://127.0.0.1:3000,
// SARVAM_OUTBOUNDS_URL=http://127.0.0.1:4011/api/outbounds/v1 and SARVAM_ANALYTICS_URL=http://127.0.0.1:4011/api/analytics/v1.
// Usage: npm run test:instant
const crypto = require('crypto'); const fs = require('fs'); const http = require('http'); const { execSync } = require('child_process'); const { chromium } = require('playwright');
const env = Object.fromEntries(fs.readFileSync(require('path').join(__dirname, '../../.env.local'), 'utf8').split('\n').filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const sql = (q) => execSync(`psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -At -c ${JSON.stringify(q.replace(/\s+/g, ' '))}`, { encoding: 'utf8' }).trim();
const BASE = process.env.BASE_URL || 'http://127.0.0.1:3000';
const ORG = 'org-i', WS = 'ws-i', APP = 'Conversatio-inst-0001', KEY = 'sk_samvaad_instant_ABCDEFGHIJ123456';
let pass = 0, fail = 0; const ok = (c, m) => { if (c) { pass++; console.log('  PASS', m); } else { fail++; console.log('  FAIL', m); } };
function encrypt(plain, aad) {
  const key = Buffer.from(env.INTEGRATION_ENCRYPTION_KEY, 'base64'); const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv); c.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
}
const placed = []; let n = 0; const attempts = {};
const server = http.createServer((req, res) => {
  let body = ''; req.on('data', (d) => (body += d)); req.on('end', () => {
    if (req.headers['x-api-key'] !== KEY) { res.writeHead(401, { 'Content-Type': 'application/json' }); return res.end('{"detail":"bad key"}'); }
    if (req.method === 'POST' && req.url === `/api/outbounds/v1/orgs/${ORG}/workspaces/${WS}/outbounds`) {
      const b = JSON.parse(body); placed.push(b);
      if (b.user_config.user_phone_number === '+919000000666') { res.writeHead(422, { 'Content-Type': 'application/json' }); return res.end('{"detail":[{"msg":"connection not allowed"}]}'); }
      res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ attempt_id: `att-${++n}` }));
    }
    if (req.url.startsWith(`/api/analytics/v1/${ORG}/${WS}/${APP}/attempts`)) {
      const f = JSON.parse(new URL('http://x' + req.url).searchParams.get('filter_conditions'))[0].value;
      res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ items: attempts[f] ? [attempts[f]] : [], total: attempts[f] ? 1 : 0 }));
    }
    res.writeHead(404); res.end();
  });
});
const callRow = (phone) => sql(`select id||'|'||status||'|'||coalesce(provider_call_id,'-') from calls where phone_e164='${phone}' order by created_at desc limit 1`).split('|');

(async () => {
  await new Promise(r => server.listen(4011, '127.0.0.1', r));
  const r = await fetch('http://127.0.0.1:54321/auth/v1/admin/users', { method: 'POST', headers: { apikey: env.SUPABASE_SECRET_KEY, Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'owner@inst.test', password: 'Passw0rd!inst', email_confirm: true }) });
  ok(r.ok, `admin user created (${r.status})`);
  const tokens = JSON.stringify({ access_token: 'e30.' + Buffer.from(JSON.stringify({ org_id: ORG, workspace_id: WS })).toString('base64url') + '.sig', refresh_token: null, expires_at: Date.now() + 6 * 3600_000, client_id: 'c1' });
  sql(`insert into integration_credentials (key, ciphertext, metadata) values ('sarvam_ai', '${encrypt(tokens, 'sarvam_ai')}', '{}')`);
  sql(`insert into integration_credentials (key, ciphertext, metadata) values ('sarvam_api_key', '${encrypt(JSON.stringify({ apiKey: KEY, orgId: ORG, workspaceId: WS }), 'integration:sarvam_api_key')}', '{}')`);
  // Fresh sync so no Sarvam MCP round trip happens before the call.
  sql(`insert into voice_agents (name, provider, provider_agent_id, provider_committed_version, provider_version, provider_synced_at, connection_status, status) values ('Sales','sarvam','${APP}',9,10,now(),'connected','ready')`);
  sql(`insert into phone_numbers (label, phone_e164, provider, provider_connection_id, provider_synced_at, connection_status, can_outbound, enabled) values ('Line','+917965482329','vobiz','conn-1',now(),'connected',true,true)`);
  sql(`insert into contacts (full_name, phone_e164, business_name) values ('Ravi','+919000000111','Ravi Cafe')`);

  const b = await chromium.launch(); const p = await b.newPage(); p.setDefaultTimeout(30000);
  const errors = []; p.on('pageerror', x => errors.push(x.message)); p.on('response', x => { if (x.status() >= 500) errors.push(`${x.status()} ${x.url()}`); });
  await p.goto(BASE + '/login'); await p.fill('#email', 'owner@inst.test'); await p.fill('#password', 'Passw0rd!inst');
  await Promise.all([p.waitForURL(u => !u.pathname.startsWith('/login')), p.click('[data-testid=auth-submit]')]);
  const placeLive = async (num) => {
    await p.goto(BASE + '/outbound'); await p.fill('#phone', num);
    await p.locator('input[name=mode][value=live]').check();
    const t = Date.now(); await p.click('[data-testid=outbound-form] button[type=submit]');
    return t;
  };
  // 1) Instant call: rings straight away, no "Queued".
  const t0 = await placeLive('9000000111');
  await p.getByText(/Calling now through Sarvam/).first().waitFor();
  const secs = (Date.now() - t0) / 1000;
  const [callA, statusA, attA] = callRow('+919000000111');
  ok(statusA === 'ringing' && attA === 'att-1', `call is Ringing straight away, not Queued (${statusA}, ${attA}) in ${secs.toFixed(1)}s`);
  const sent = placed[0];
  ok(sent.app_config.app_id === APP && sent.app_config.app_version === 9 && sent.app_config.connection_config.connection_id === 'conn-1' && sent.app_config.connection_config.agent_phone_number === '+917965482329' && sent.user_config.user_phone_number === '+919000000111', 'sends published v9, the line and the customer number');
  ok(sent.app_config.agent_variables?.user_name === 'Ravi' && sent.app_config.agent_variables?.business_name === 'Ravi Cafe', 'passes the contact name and business to the agent');
  const meta = sent.webhook_config.metadata;
  ok(sent.webhook_config.url === `${BASE}/api/webhooks/telephony/sarvam` && meta.call_id === callA && typeof meta.crm_secret === 'string', 'result webhook points at the CRM with call id and secret');
  // Wrong secret refused.
  const bad = await fetch(BASE + '/api/webhooks/telephony/sarvam', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ attempt_id: 'att-1', status: 'connected', webhook_config: { metadata: { ...meta, crm_secret: 'nope' } } }) });
  ok(bad.status === 401, `instant result with wrong secret refused (${bad.status})`);
  // 2) Result arrives: completed with transcript, outcome, emotion, interest, recording.
  const wh = await fetch(BASE + '/api/webhooks/telephony/sarvam', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ attempt_id: 'att-1', status: 'connected', channel_info: { channel_type: 'v2v', channel_provider: 'vobiz', agent_phone_number: '+917965482329' }, duration: 42.4, interaction_id: '20261108/int-inst-1', failure_reason: null, final_agent_variables: { call_summary: 'Owner wants a callback tomorrow.', consultation_outcome: 'callback_requested', lead_temperature: 'WARM' }, webhook_config: sent.webhook_config, interaction_transcript: [{ role: 'agent', en_text: 'Hello' }, { role: 'user', en_text: 'Call me tomorrow please' }] }) });
  ok(wh.ok, `instant result accepted (${wh.status})`);
  ok(sql(`select status||'|'||duration_seconds||'|'||outcome from calls where id='${callA}'`) === 'completed|42|callback_requested', 'call completed with duration and outcome');
  ok(sql(`select interest from call_log_view where id='${callA}'`) === 'callback', 'interest: Callback');
  ok(sql(`select count(*) from call_transcripts where call_id='${callA}'`) === '1' && sql(`select count(*) from call_recordings where call_id='${callA}'`) === '1', 'transcript stored and recording linked');
  ok(sql(`select lead_stage from contacts where phone_e164='+919000000111'`) === 'callback', 'contact funnel moved to Callback');
  ok(sql(`select count(*) from call_events where payload::text like '%${meta.crm_secret}%'`) === '0', 'webhook secret never stored');
  ok(sql(`select count(*) from calls where phone_e164='+919000000111'`) === '1', 'no duplicate call rows');
  // 3) Safety net: no webhook arrives; after 5 minutes the attempts report finishes the call.
  await placeLive('9000000222'); await p.getByText(/Calling now through Sarvam/).first().waitFor();
  const [callB, , attB] = callRow('+919000000222');
  sql(`update calls set started_at = now() - interval '10 minutes' where id='${callB}'`);
  attempts[attB] = { attempt_id: attB, connectivity_status: 'no_answer', failure_reason: 'NO_FAILURE_REASON', duration_in_seconds: 0, interaction_id: null };
  const cron = await (await fetch(BASE + '/api/cron/campaigns', { headers: { Authorization: `Bearer ${env.CRON_SECRET}` } })).json();
  ok(cron.reconciled === 1 && callRow('+919000000222')[1] === 'no_answer', `lost result recovered from Sarvam's report (${JSON.stringify(cron.reconciled)}, ${callRow('+919000000222')[1]})`);
  // 4) Sarvam refuses the instant call → recorded, falls back (here the fallback cannot reach Sarvam, so it fails clearly).
  await placeLive('9000000666');
  let callC = '', statusC = '';
  for (let i = 0; i < 60; i++) {
    const row = sql(`select id||'|'||status from calls where phone_e164='+919000000666' order by created_at desc limit 1`);
    if (row) {
      [callC, statusC] = row.split('|');
      const done = statusC !== 'queued' || sql(`select count(*) from call_events where call_id='${callC}' and event_type in ('submitted_to_sarvam','instant_call_refused')`) !== '0';
      if (done && sql(`select count(*) from call_events where call_id='${callC}' and event_type in ('submitted_to_sarvam','failed')`) !== '0') break;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  ok(sql(`select count(*) from call_events where call_id='${callC}' and event_type='instant_call_refused'`) === '1', 'refusal recorded before falling back');
  ok(statusC !== 'queued' || sql(`select count(*) from call_events where call_id='${callC}' and event_type='submitted_to_sarvam'`) === '1', `never silently stuck (status ${statusC})`);
  ok(errors.length === 0, `no page errors / 5xx (${errors.join('; ')})`);
  await b.close(); server.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); server.close(); process.exit(1); });
