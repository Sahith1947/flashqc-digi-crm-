/* eslint-disable */
// New published agent versions in Sarvam reach the CRM automatically, against a local fake Sarvam MCP.
// Needs a freshly reset local DB and the app started with SARVAM_MCP_URL=http://127.0.0.1:4012/voice-agents.
// Usage: npm run test:versions
const crypto = require('crypto'); const fs = require('fs'); const http = require('http'); const { execSync } = require('child_process'); const { chromium } = require('playwright');
const env = Object.fromEntries(fs.readFileSync(require('path').join(__dirname, '../../.env.local'), 'utf8').split('\n').filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const sql = (q) => execSync(`psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -At -c ${JSON.stringify(q.replace(/\s+/g, ' '))}`, { encoding: 'utf8' }).trim();
const BASE = process.env.BASE_URL || 'http://127.0.0.1:3000';
const APP = 'Conversatio-ver-0001';
let pass = 0, fail = 0; const ok = (c, m) => { if (c) { pass++; console.log('  PASS', m); } else { fail++; console.log('  FAIL', m); } };
function encrypt(plain, aad) {
  const key = Buffer.from(env.INTEGRATION_ENCRYPTION_KEY, 'base64'); const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv); c.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
}
// Fake Sarvam state: committed versions, a draft, one inbound deployment on the CRM's number.
const sarvam = { committed: [1, 2, 3, 4, 5], draft: 6, deployment: { deployment_id: 'dep-1', name: 'FlashQC inbound', app_id: APP, app_version: 3, phone_numbers: ['+917965482329'], status: 'active' } };
const calls = [];
const text = (o) => ({ content: [{ type: 'text', text: JSON.stringify(o) }] });
function tool(name, a) {
  calls.push(`${name}:${a.operation ?? ''}${a.app_version ? `:v${a.app_version}` : ''}`);
  if (name === 'agents' && a.operation === 'list') return text({ items: [{ app_id: APP, app_name: 'Sales Agent', app_version: sarvam.draft, status: 'draft', channel_type: 'v2v', is_deployed: true }], pagination: { more: false } });
  if (name === 'agents' && a.operation === 'get') return text({ config: { app_id: APP, app_name: 'Sales Agent', app_version: sarvam.draft, status: 'draft', channel_type: 'v2v', language_config: { initial_language_name: 'Telugu', supported_languages: ['Telugu'] } }, versions: [...sarvam.committed.map((v) => ({ app_version: v, status: 'committed' })), { app_version: sarvam.draft, status: 'draft' }] });
  if (name === 'telephony' && a.operation === 'list_deployments') return text({ items: [sarvam.deployment] });
  if (name === 'telephony' && a.operation === 'pause_deployment') { sarvam.deployment.status = 'paused'; return text({ ok: true }); }
  if (name === 'telephony' && a.operation === 'resume_deployment') { sarvam.deployment.status = 'active'; return text({ ok: true }); }
  if (name === 'configure_deployment') {
    if (sarvam.deployment.status !== 'paused') return { isError: true, content: [{ type: 'text', text: '(409) Conflict deployment must be paused' }] };
    if (a.app_version) sarvam.deployment.app_version = a.app_version;
    return text({ deployment_id: 'dep-1', app_version: sarvam.deployment.app_version });
  }
  return text({});
}
const server = http.createServer((req, res) => {
  let body = ''; req.on('data', (d) => (body += d)); req.on('end', () => {
    const m = JSON.parse(body || '{}');
    if (!m.id) { res.writeHead(202); return res.end(); }
    let result = {};
    if (m.method === 'initialize') result = { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'fake' } };
    if (m.method === 'tools/call') result = tool(m.params.name, m.params.arguments || {});
    res.writeHead(200, { 'Content-Type': 'application/json', 'Mcp-Session-Id': 's1' }); res.end(JSON.stringify({ jsonrpc: '2.0', id: m.id, result }));
  });
});

(async () => {
  await new Promise(r => server.listen(4012, '127.0.0.1', r));
  const r = await fetch('http://127.0.0.1:54321/auth/v1/admin/users', { method: 'POST', headers: { apikey: env.SUPABASE_SECRET_KEY, Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'owner@ver.test', password: 'Passw0rd!ver', email_confirm: true }) });
  ok(r.ok, `admin user created (${r.status})`);
  const tokens = JSON.stringify({ access_token: 'e30.e30.sig', refresh_token: null, expires_at: Date.now() + 6 * 3600_000, client_id: 'c1' });
  sql(`insert into integration_credentials (key, ciphertext, metadata) values ('sarvam_ai', '${encrypt(tokens, 'sarvam_ai')}', '{"account_email":"owner@ver.test"}')`);
  // The CRM last synced long ago, when v4 was the newest published version; inbound sync is on.
  sql(`insert into voice_agents (name, provider, provider_agent_id, provider_committed_version, provider_version, provider_synced_at, connection_status) values ('Sales Agent','sarvam','${APP}',4,4,now() - interval '1 hour','connected')`);
  sql(`insert into phone_numbers (label, phone_e164, provider, provider_connection_id, provider_synced_at, connection_status) values ('Line','+917965482329','vobiz','conn-1',now(),'connected')`);
  sql(`update app_settings set sarvam_inbound_webhook_at = now()`);

  // 1) Automatic: the scheduled job (same path as page visits and live calls) notices v5 and moves the inbound line.
  const cron = await fetch(BASE + '/api/cron/campaigns', { headers: { Authorization: `Bearer ${env.CRON_SECRET}` } });
  const cj = await cron.json();
  ok(cron.ok && cj.agents?.synced === true, `auto sync ran (${JSON.stringify(cj.agents)})`);
  ok(sql(`select provider_committed_version||'|'||provider_version from voice_agents where provider_agent_id='${APP}'`) === '5|6', 'CRM now knows published v5 (draft v6 is not used)');
  ok(JSON.stringify(cj.agents?.changed) === JSON.stringify([{ agent: 'Sales Agent', from: 4, to: 5 }]), 'reports the version change v4 → v5');
  ok(sarvam.deployment.app_version === 5 && sarvam.deployment.status === 'active', `inbound line moved to v5 and is active again (v${sarvam.deployment.app_version}, ${sarvam.deployment.status})`);
  const seq = calls.filter((c) => /deployment/.test(c));
  ok(seq.join(',') === 'telephony:list_deployments,telephony:pause_deployment,configure_deployment::v5,telephony:resume_deployment', `pause → switch → resume (${seq.join(',')})`);
  // 2) Fresh sync: nothing is re-read within 5 minutes.
  calls.length = 0;
  const cron2 = await (await fetch(BASE + '/api/cron/campaigns', { headers: { Authorization: `Bearer ${env.CRON_SECRET}` } })).json();
  ok(cron2.agents?.synced === false && calls.length === 0, 'no extra Sarvam calls when synced recently');
  // 3) Publish v6 in Sarvam, then "Sync from Sarvam" on Voice Agents.
  sarvam.committed.push(6); sarvam.draft = 7;
  const b = await chromium.launch(); const p = await b.newPage(); p.setDefaultTimeout(30000);
  const errors = []; p.on('pageerror', x => errors.push(x.message)); p.on('response', x => { if (x.status() >= 500) errors.push(`${x.status()} ${x.url()}`); });
  await p.goto(BASE + '/login'); await p.fill('#email', 'owner@ver.test'); await p.fill('#password', 'Passw0rd!ver');
  await Promise.all([p.waitForURL(u => !u.pathname.startsWith('/login')), p.click('[data-testid=auth-submit]')]);
  await p.goto(BASE + '/voice-agents');
  ok((await p.getByTestId('sarvam-agent-meta').innerText()).includes('Calls use v5 (published)'), 'Voice Agents shows the version calls use (v5)');
  await p.getByTestId('sync-agents').click();
  await p.getByText(/Incoming calls now use v6/).first().waitFor();
  ok(sarvam.deployment.app_version === 6 && sarvam.deployment.status === 'active', 'Sync button: inbound line moved to v6');
  await p.goto(BASE + '/voice-agents');
  const meta = await p.getByTestId('sarvam-agent-meta').innerText();
  ok(meta.includes('Calls use v6 (published)') && meta.includes('Draft v7'), `Voice Agents: ${meta.replace(/\n+/g, ' | ')}`);
  ok(errors.length === 0, `no page errors / 5xx (${errors.join('; ')})`);
  await b.close(); server.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); server.close(); process.exit(1); });
