/* eslint-disable */
// Live bulk campaigns end to end against a local fake Sarvam (MCP + REST): instant kickoff, Sarvam campaign,
// results by webhook, a lost result recovered from the attempts report, completion, pause/resume/cancel.
// App env: APP_URL=http://127.0.0.1:3000 SARVAM_MCP_URL=http://127.0.0.1:4012/voice-agents
//          SARVAM_OUTBOUNDS_URL=http://127.0.0.1:4011/api/outbounds/v1 SARVAM_ANALYTICS_URL=http://127.0.0.1:4011/api/analytics/v1
// Usage: npm run test:campaigns
const crypto = require('crypto'); const fs = require('fs'); const http = require('http'); const { execSync } = require('child_process'); const { chromium } = require('playwright');
const env = Object.fromEntries(fs.readFileSync(require('path').join(__dirname, '../../.env.local'), 'utf8').split('\n').filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const sql = (q) => execSync(`psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -At -c ${JSON.stringify(q.replace(/\s+/g, ' '))}`, { encoding: 'utf8' }).trim();
const BASE = process.env.BASE_URL || 'http://127.0.0.1:3000';
const ORG = 'org-c', WS = 'ws-c', APP = 'Conversatio-camp-0001', KEY = 'sk_samvaad_campaign_ABCDEFGH12345678';
const SECRET = Buffer.from(crypto.hkdfSync('sha256', env.INTEGRATION_ENCRYPTION_KEY, 'flashqc-crm', 'sarvam-webhook-v1', 32)).toString('hex');
let pass = 0, fail = 0; const ok = (c, m) => { if (c) { pass++; console.log('  PASS', m); } else { fail++; console.log('  FAIL', m); } };
function encrypt(plain, aad) {
  const key = Buffer.from(env.INTEGRATION_ENCRYPTION_KEY, 'base64'); const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv); c.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
}
// ---- fake Sarvam ----
const mcp = []; const instants = []; const report = []; let nCamp = 0, nAtt = 0;
const text = (o) => ({ content: [{ type: 'text', text: JSON.stringify(o) }] });
function tool(name, a) {
  mcp.push({ name, a });
  if (name === 'configure_campaign') return text({ id: a.campaign_id ?? `camp-${++nCamp}` });
  if (name === 'stream_cohort_users') return text({ id: `cohort-${mcp.length}` });
  if (name === 'campaigns') return text({ ok: true });
  if (name === 'agents' && a.operation === 'list') return text({ items: [], pagination: { more: false } });
  if (name === 'telephony') return text({ items: [] });
  return text({});
}
const mcpServer = http.createServer((req, res) => {
  let body = ''; req.on('data', (d) => (body += d)); req.on('end', () => {
    const m = JSON.parse(body || '{}'); if (!m.id) { res.writeHead(202); return res.end(); }
    const result = m.method === 'initialize' ? { protocolVersion: '2025-06-18', capabilities: {} } : m.method === 'tools/call' ? tool(m.params.name, m.params.arguments || {}) : {};
    res.writeHead(200, { 'Content-Type': 'application/json', 'Mcp-Session-Id': 's1' }); res.end(JSON.stringify({ jsonrpc: '2.0', id: m.id, result }));
  });
});
const restServer = http.createServer((req, res) => {
  let body = ''; req.on('data', (d) => (body += d)); req.on('end', () => {
    if (req.headers['x-api-key'] !== KEY) { res.writeHead(401); return res.end('{}'); }
    if (req.method === 'POST' && req.url.endsWith('/outbounds')) { const b = JSON.parse(body); const id = `inst-${++nAtt}`; instants.push({ ...b, attempt_id: id }); res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ attempt_id: id })); }
    if (req.url.includes('/attempts')) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ items: report, total: report.length })); }
    res.writeHead(404); res.end();
  });
});
const post = async (b) => { const r = await fetch(BASE + '/api/webhooks/telephony/sarvam', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); return r.status; };

(async () => {
  await new Promise(r => mcpServer.listen(4012, '127.0.0.1', r)); await new Promise(r => restServer.listen(4011, '127.0.0.1', r));
  const r = await fetch('http://127.0.0.1:54321/auth/v1/admin/users', { method: 'POST', headers: { apikey: env.SUPABASE_SECRET_KEY, Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'owner@camp.test', password: 'Passw0rd!camp', email_confirm: true }) });
  ok(r.ok, `admin user created (${r.status})`);
  const tokens = JSON.stringify({ access_token: 'e30.' + Buffer.from(JSON.stringify({ org_id: ORG, workspace_id: WS })).toString('base64url') + '.sig', refresh_token: null, expires_at: Date.now() + 6 * 3600_000, client_id: 'c1' });
  sql(`insert into integration_credentials (key, ciphertext, metadata) values ('sarvam_ai', '${encrypt(tokens, 'sarvam_ai')}', '{}'), ('sarvam_api_key', '${encrypt(JSON.stringify({ apiKey: KEY, orgId: ORG, workspaceId: WS }), 'integration:sarvam_api_key')}', '{}')`);
  sql(`insert into voice_agents (name, provider, provider_agent_id, provider_committed_version, provider_version, provider_synced_at, connection_status, status) values ('Sales','sarvam','${APP}',9,10,now(),'connected','ready')`);
  sql(`insert into phone_numbers (label, phone_e164, provider, provider_connection_id, provider_synced_at, connection_status, can_outbound, enabled) values ('Line','+917965482329','vobiz','conn-1',now(),'connected',true,true)`);
  const phones = Array.from({ length: 8 }, (_, i) => `+9191000000${10 + i}`);
  sql(`insert into contacts (full_name, phone_e164, business_name) values ${phones.map((p, i) => `('Client ${i + 1}','${p}','Shop ${i + 1}')`).join(',')}`);
  sql(`update contacts set dnd_status='registered' where phone_e164='${phones[6]}'`);
  sql(`update contacts set consent_status='revoked' where phone_e164='${phones[7]}'`);
  const mkCampaign = (name) => {
    const id = sql(`insert into campaigns (name, mode, status, max_attempts, calling_window_start, calling_window_end, voice_agent_id, phone_number_id) select '${name}','live','draft',2,'00:00','23:59',(select id from voice_agents limit 1),(select id from phone_numbers limit 1) returning id`).split('\n')[0];
    sql(`insert into campaign_contacts (campaign_id, contact_id, status) select '${id}', id, 'pending' from contacts`);
    return id;
  };
  const camp = mkCampaign('Diwali Offer');
  const cc = (phone) => sql(`select x.id from campaign_contacts x join contacts c on c.id=x.contact_id where x.campaign_id='${camp}' and c.phone_e164='${phone}'`);

  const b = await chromium.launch(); const p = await b.newPage(); p.setDefaultTimeout(30000);
  const errors = []; p.on('pageerror', x => errors.push(x.message)); p.on('response', x => { if (x.status() >= 500) errors.push(`${x.status()} ${x.url()}`); });
  await p.goto(BASE + '/login'); await p.fill('#email', 'owner@camp.test'); await p.fill('#password', 'Passw0rd!camp');
  await Promise.all([p.waitForURL(u => !u.pathname.startsWith('/login')), p.click('[data-testid=auth-submit]')]);

  // ---- Start: instant kickoff for the first 5, the rest to the Sarvam campaign ----
  await p.goto(BASE + `/campaigns/${camp}`);
  const t0 = Date.now(); await p.getByTestId('campaign-start').click();
  await p.getByText(/5 calls are ringing now; Sarvam dials the other 1/).first().waitFor();
  ok(true, `start: "5 calls are ringing now; Sarvam dials the other 1" in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  const create = mcp.find((x) => x.name === 'configure_campaign' && !x.a.campaign_id);
  const lead = (Date.parse(create.a.start_timestamp) - t0) / 1000;
  ok(create.a.app_config.app_version === 9 && create.a.app_config.retry_config && create.a.allowed_schedule.allowed_start_time === '00:00' && create.a.app_config.webhook_config.metadata.crm_secret === SECRET, 'Sarvam campaign: published v9, retries, window and CRM webhook');
  ok(lead >= 120 && lead < 150, `Sarvam campaign starts ${lead.toFixed(0)}s ahead (Sarvam minimum 120s)`);
  ok(instants.length === 5 && instants.every((x) => x.webhook_config.metadata.cc_id && x.app_config.app_version === 9), '5 contacts dialled instantly with their campaign contact id');
  const streamed = mcp.filter((x) => x.name === 'stream_cohort_users');
  ok(streamed.length === 1 && streamed[0].a.users.length === 1 && streamed[0].a.users[0].user_identifier.startsWith('cc:'), 'remaining 1 contact handed to the Sarvam campaign');
  ok(sql(`select string_agg(skip_reason, ' | ' order by skip_reason) from campaign_contacts where campaign_id='${camp}' and status='skipped'`).split(' | ').length === 2, 'DND and revoked-consent contacts skipped with a reason');
  ok(sql(`select count(*) from calls where campaign_id='${camp}' and status='ringing'`) === '5' && sql(`select count(*) from campaign_contacts where campaign_id='${camp}' and status='in_progress'`) === '6', '5 calls Ringing, 6 contacts in progress, none Queued');
  ok(!(await p.locator('body').innerText()).includes('Queued'), 'nothing shows "Queued"');

  // ---- Instant results ----
  const byPhone = Object.fromEntries(instants.map((x) => [x.user_config.user_phone_number, x]));
  const instantResult = (phone, status, vars, dur) => post({ attempt_id: byPhone[phone].attempt_id, status, channel_info: { agent_phone_number: '+917965482329' }, duration: dur, interaction_id: status === 'connected' ? `20261108/i-${phone.slice(-2)}` : null, final_agent_variables: vars, webhook_config: byPhone[phone].webhook_config, interaction_transcript: status === 'connected' ? [{ role: 'user', en_text: 'ok' }] : null });
  const s1 = await instantResult(phones[0], 'connected', { consultation_outcome: 'whatsapp_details_requested', lead_temperature: 'WARM', call_summary: 'Wants WhatsApp details.' }, 60);
  const s2 = await instantResult(phones[1], 'connected', { consultation_outcome: 'not_interested', lead_temperature: 'COLD', call_summary: 'Not interested.' }, 30);
  const s3 = await instantResult(phones[2], 'no_answer', null, null);
  const s4 = await instantResult(phones[3], 'busy', null, null);
  const s5 = await instantResult(phones[4], 'connected', { consultation_outcome: 'meeting_booked', lead_temperature: 'HOT', call_summary: 'Meeting tomorrow 11am.' }, 90);
  ok([s1, s2, s3, s4, s5].every((s) => s === 200), 'instant results accepted');
  ok(sql(`select status from campaign_contacts where id='${cc(phones[0])}'`) === 'completed' && sql(`select status from campaign_contacts where id='${cc(phones[2])}'`) === 'failed', 'campaign contacts updated from instant results');
  ok(sql(`select count(*) from calls where campaign_id='${camp}'`) === '5', 'no duplicate call rows');
  // ---- Streamed contact: busy (retry), then its retry result is lost → recovered from Sarvam's report ----
  const ccLast = cc(phones[5]);
  ok((await post({ campaign_id: 'camp-1', attempt_id: 'att-a', completion_status: 'failed', connectivity_status: 'busy', next_action_status: 'retry', retry_attempt: 0, user_identifier: `cc:${ccLast}`, user_phone_number: phones[5], app_id: APP, metadata: { crm_secret: SECRET } })) === 200, 'campaign attempt webhook accepted');
  ok(sql(`select status||'|'||attempts from campaign_contacts where id='${ccLast}'`) === 'in_progress|1', 'busy with retry → still in progress');
  report.push({ attempt_id: 'att-b', user_identifier: `cc:${ccLast}`, user_contact: phones[5], campaign_id: 'camp-1', connectivity_status: 'connected', next_action_status: 'UNKNOWN', retry_attempt: 2, duration_in_seconds: 45, interaction_id: '20261108/i-retry', failure_reason: 'NO_FAILURE_REASON', start_datetime: '2026-11-08T10:00:00', end_datetime: '2026-11-08T10:00:45', attempted_at: '2026-11-08T09:59:50', app_version: 9, agent_variables: { consultation_outcome: 'callback_requested', lead_temperature: 'WARM', call_summary: 'Call back on Monday.' } });
  sql(`update campaign_contacts set last_attempt_at = now() - interval '5 minutes' where id='${ccLast}'`);
  await p.goto(BASE + `/campaigns/${camp}`); await p.getByTestId('refresh-campaign-results').click();
  await p.getByText(/1 missing result added from Sarvam/).first().waitFor();
  ok(sql(`select status||'|'||attempts||'|'||outcome from campaign_contacts where id='${ccLast}'`) === 'completed|2|callback_requested', 'lost retry result recovered: completed, 2 attempts, callback');
  ok(sql(`select status from campaigns where id='${camp}'`) === 'completed', 'campaign completes when every contact has a final result');
  await p.goto(BASE + `/campaigns/${camp}`);
  const chips = (await p.getByTestId('interest-chips').innerText()).replace(/\n+/g, ' ');
  ok(/Interested 2/.test(chips) && /Callback 1/.test(chips) && /Not interested 1/.test(chips) && /No answer 2/.test(chips) && /Skipped \(DND \/ no consent\) 2/.test(chips), `results chips: ${chips}`);

  // ---- Pause / resume on a newer version / cancel ----
  const camp2 = mkCampaign('Pause Test');
  sql(`update contacts set dnd_status='unknown', consent_status='unknown'`);
  await p.goto(BASE + `/campaigns/${camp2}`); await p.getByTestId('campaign-start').click();
  await p.getByText(/Campaign is running/).first().waitFor();
  const id2 = sql(`select provider_campaign_id from campaigns where id='${camp2}'`);
  await p.getByTestId('campaign-pause').click(); await p.getByRole('button', { name: 'Resume' }).waitFor();
  ok(mcp.some((x) => x.name === 'campaigns' && x.a.operation === 'pause' && x.a.id === id2), 'pause reaches Sarvam');
  sql(`update voice_agents set provider_committed_version = 10, provider_synced_at = now()`); // a newer version was published
  await p.reload(); await p.getByRole('button', { name: 'Resume' }).click();
  for (let i = 0; i < 40 && !mcp.some((x) => x.name === 'campaigns' && x.a.operation === 'resume'); i++) await new Promise((r) => setTimeout(r, 500));
  await p.getByTestId('campaign-pause').waitFor();
  const patch = mcp.find((x) => x.name === 'configure_campaign' && x.a.campaign_id === id2);
  if (!patch) console.log('    MCP calls after pause:', JSON.stringify(mcp.slice(-6).map((x) => [x.name, x.a.operation ?? '', x.a.campaign_id ?? x.a.id ?? '', x.a.app_config?.app_version ?? ''])));
  const resumeIdx = mcp.findIndex((x) => x.name === 'campaigns' && x.a.operation === 'resume' && x.a.id === id2);
  ok(patch && patch.a.app_config.app_version === 10 && mcp.indexOf(patch) < resumeIdx, 'resume switches the paused campaign to v10, then resumes');
  await p.getByTestId('campaign-cancel').click(); await p.getByTestId('campaign-cancel-confirm').click();
  await p.getByText(/Campaign cancelled/).first().waitFor();
  ok(mcp.some((x) => x.name === 'campaigns' && x.a.operation === 'cancel' && x.a.id === id2) && sql(`select status from campaigns where id='${camp2}'`) === 'cancelled', 'cancel reaches Sarvam');
  ok(errors.length === 0, `no page errors / 5xx (${errors.join('; ')})`);
  await b.close(); mcpServer.close(); restServer.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); mcpServer.close(); restServer.close(); process.exit(1); });
