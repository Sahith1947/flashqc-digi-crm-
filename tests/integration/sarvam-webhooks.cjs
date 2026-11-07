/* eslint-disable */
// Sarvam call-webhook ingestion tests (payloads follow sarvam://schemas/webhook-payload).
// Needs a freshly reset local DB and the app on BASE_URL. Usage: npm run test:webhooks
const crypto = require('crypto'); const fs = require('fs'); const { execSync } = require('child_process');
const env = Object.fromEntries(fs.readFileSync(require('path').join(__dirname, '../../.env.local'), 'utf8').split('\n').filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const SECRET = Buffer.from(crypto.hkdfSync('sha256', env.INTEGRATION_ENCRYPTION_KEY, 'flashqc-crm', 'sarvam-webhook-v1', 32)).toString('hex');
const sql = (q) => execSync(`psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -At -c ${JSON.stringify(q.replace(/\s+/g, ' '))}`, { encoding: 'utf8' }).trim();
const BASE = process.env.BASE_URL || 'http://127.0.0.1:3000';
const post = async (body, secret = SECRET) => { const r = await fetch(BASE + '/api/webhooks/telephony/sarvam', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, metadata: { ...(body.metadata || {}), crm_secret: secret } }) }); return [r.status, await r.json()]; };
let pass = 0, fail = 0; const ok = (c, m) => { if (c) { pass++; console.log('  PASS', m); } else { fail++; console.log('  FAIL', m); } };
const transcript = [{ role: 'agent', en_text: 'Hello! Am I speaking with the business owner?' }, { role: 'user', en_text: 'Yes, tell me.', indic_text: 'అవును, చెప్పండి.' }, { role: 'agent', en_text: 'We help restaurants get more customers online. Can I book a 15 minute call?' }, { role: 'user', en_text: 'OK, tomorrow 11am.' }];
const vars = { call_summary: 'Owner of Hotel Paradise agreed to a meeting tomorrow 11am to discuss Google ads.', consultation_outcome: 'meeting_booked', lead_temperature: 'HOT', monthly_budget: '15000', required_services: 'Google ads, Instagram' };
(async () => {
  // setup: business line, synced Sarvam agent, contact, live campaign with one contact, queued direct call
  sql(`insert into voice_agents (name, provider, provider_agent_id, provider_committed_version, provider_synced_at, connection_status) values ('FlashQC Digi Sales Executive','sarvam','Conversatio-ef4d6b32-0d9b',2,now(),'connected')`);
  sql(`insert into phone_numbers (label, phone_e164, provider, provider_connection_id, provider_synced_at, connection_status) values ('Sarvam vobiz 2329','+917965482329','vobiz','f434ee2c-ac-8b86f7ac-b979',now(),'connected')`);
  sql(`insert into contacts (full_name, phone_e164, business_name, city) values ('Ravi Kumar','+919848012345','Hotel Paradise','Hyderabad'), ('Lakshmi','+919848054321','Lakshmi Clinic','Vizag')`);
  sql(`insert into campaigns (name, mode, status, max_attempts, provider, provider_campaign_id) values ('Live pilot','live','running',2,'sarvam','camp-123')`);
  const cc1 = sql(`insert into campaign_contacts (campaign_id, contact_id, status) select c.id, k.id, 'in_progress' from campaigns c, contacts k where c.name='Live pilot' and k.full_name='Ravi Kumar' returning id`).split('\n')[0];
  const cc2 = sql(`insert into campaign_contacts (campaign_id, contact_id, status) select c.id, k.id, 'in_progress' from campaigns c, contacts k where c.name='Live pilot' and k.full_name='Lakshmi' returning id`).split('\n')[0];
  const direct = sql(`insert into calls (direction, status, phone_e164, is_simulated) values ('outbound','queued','+919848012345',false) returning id`).split('\n')[0];

  let [s, j] = await post({ deployment_id: 'dep-1', app_id: 'Conversatio-ef4d6b32-0d9b', interaction_id: 'int-1', user_phone_number: '+919848054321', agent_phone_number: '+917965482329' }, 'wrong-secret');
  ok(s === 401, `wrong secret rejected (${s})`);
  [s, j] = await post({ deployment_id: 'dep-1', app_id: 'Conversatio-ef4d6b32-0d9b', interaction_id: 'int-1', user_phone_number: '+919848054321' });
  ok(s === 401 || s === 200, 'missing secret path exercised'); // has secret via helper; check missing below
  const r0 = await fetch(BASE + '/api/webhooks/telephony/sarvam', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deployment_id: 'x', app_id: 'a', interaction_id: 'i', user_phone_number: '+919848054321', agent_phone_number: '+917965482329' }) });
  ok(r0.status === 401, `no secret rejected (${r0.status})`);

  // inbound
  const inbound = { deployment_id: 'FlashQC-Dig-1eb66f90-b322', app_id: 'Conversatio-ef4d6b32-0d9b', app_version: 3, interaction_id: 'int-inbound-1', user_phone_number: '+919848054321', agent_phone_number: '+917965482329', duration: 94.6, recording_url: 'https://recordings.sarvam.ai/int-inbound-1.wav?sig=abc', start_datetime: '2026-11-08T05:30:00Z', end_datetime: '2026-11-08T05:31:35Z', interaction_transcript: transcript, final_agent_variables: vars };
  [s, j] = await post(inbound);
  ok(s === 200, `inbound accepted (${s} ${JSON.stringify(j).slice(0, 80)})`);
  const ib = sql(`select direction||'|'||status||'|'||duration_seconds||'|'||coalesce(outcome,'-')||'|'||(contact_id is not null)||'|'||(phone_number_id is not null)||'|'||(voice_agent_id is not null) from calls where provider_call_id='int-inbound-1'`);
  ok(ib === 'inbound|completed|95|converted|true|true|true', `inbound call row: ${ib}`);
  ok(sql(`select t.source||'|'||t.provider||'|'||(content like '%అవును%') from call_transcripts t join calls c on c.id=t.call_id where c.provider_call_id='int-inbound-1'`) === 'provider|sarvam|true', 'inbound transcript stored (incl. Telugu)');
  ok(sql(`select s.source||'|'||sentiment||'|'||suggested_outcome||'|'||jsonb_array_length(key_points) from call_summaries s join calls c on c.id=s.call_id where c.provider_call_id='int-inbound-1'`) === 'ai|positive|meeting_booked|4', 'AI summary with lead data stored');
  ok(sql(`select r.source||'|'||provider_recording_url from call_recordings r join calls c on c.id=r.call_id where c.provider_call_id='int-inbound-1'`) === 'provider|https://recordings.sarvam.ai/int-inbound-1.wav?sig=abc', 'recording URL stored');
  [s] = await post(inbound);
  ok(s === 200 && sql(`select count(*) from calls where provider_call_id='int-inbound-1'`) === '1' && sql(`select count(*) from call_recordings`) === '1', 'redelivery is idempotent');

  // direct live call
  [s, j] = await post({ campaign_id: 'direct-camp', attempt_id: 'att-direct-1', cohort_id: 'co1', completion_status: 'completed', connectivity_status: 'connected', user_identifier: `call:${direct}`, user_phone_number: '+919848012345', agent_phone_number: '+917965482329', app_id: 'Conversatio-ef4d6b32-0d9b', app_version: 2, duration: 61, interaction_id: 'int-d1', start_datetime: '2026-11-08T06:00:00Z', end_datetime: '2026-11-08T06:01:01Z', interaction_transcript: transcript, final_agent_variables: { ...vars, consultation_outcome: 'callback_requested', lead_temperature: 'WARM' } });
  ok(s === 200 && j.call_id === direct, 'direct live call result updates the queued CRM call');
  ok(sql(`select status||'|'||provider_call_id||'|'||duration_seconds||'|'||outcome from calls where id='${direct}'`) === 'completed|att-direct-1|61|callback_requested', 'direct call completed with outcome');

  // campaign: first attempt no answer with retry pending, then answered
  [s] = await post({ campaign_id: 'camp-123', attempt_id: 'att-c1-0', cohort_id: 'co2', completion_status: 'failed', connectivity_status: 'no_answer', next_action_status: 'retry', retry_attempt: 0, user_identifier: `cc:${cc1}`, user_phone_number: '+919848012345', app_id: 'Conversatio-ef4d6b32-0d9b', executed_at: '2026-11-08T07:00:00+05:30' });
  ok(s === 200 && sql(`select status||'|'||attempts from campaign_contacts where id='${cc1}'`) === 'in_progress|1', 'no-answer with retry keeps contact in progress');
  [s] = await post({ campaign_id: 'camp-123', attempt_id: 'att-c1-1', cohort_id: 'co2', completion_status: 'completed', connectivity_status: 'connected', retry_attempt: 1, user_identifier: `cc:${cc1}`, user_phone_number: '+919848012345', app_id: 'Conversatio-ef4d6b32-0d9b', duration: 120, start_datetime: '2026-11-08T08:00:00Z', end_datetime: '2026-11-08T08:02:00Z', interaction_transcript: transcript, final_agent_variables: vars });
  ok(sql(`select status||'|'||attempts||'|'||outcome from campaign_contacts where id='${cc1}'`) === 'completed|2|converted', 'answered retry completes contact');
  ok(sql(`select count(*) from calls where campaign_id=(select id from campaigns where name='Live pilot')`) === '2', 'each attempt is its own call in Call Logs');
  ok(sql(`select status from campaigns where name='Live pilot'`) === 'running', 'campaign still running while a contact is open');
  [s] = await post({ campaign_id: 'camp-123', attempt_id: 'att-c2-0', cohort_id: 'co2', completion_status: 'failed', connectivity_status: 'busy', retry_attempt: 0, user_identifier: `cc:${cc2}`, user_phone_number: '+919848054321', app_id: 'Conversatio-ef4d6b32-0d9b', failure_reason: 'User busy' });
  ok(sql(`select status||'|'||outcome from campaign_contacts where id='${cc2}'`) === 'failed|busy', 'terminal busy marks contact failed');
  ok(sql(`select status from campaigns where name='Live pilot'`) === 'completed', 'campaign completes when every contact has a final result');
  ok(sql(`select count(*) from call_transcripts t join calls c on c.id=t.call_id where c.provider_call_id='att-c2-0'`) === '0', 'no transcript invented for unanswered call');
  [s] = await post({ foo: 'bar' }); ok(s === 500, `unknown payload rejected (${s})`);
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
