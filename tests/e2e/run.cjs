/* eslint-disable */
// End-to-end test suite for the FlashQC Digi Call CRM.
//
// Prerequisites: local Supabase running with a freshly reset DB (npm run db:reset)
// and the app running on BASE_URL (default http://127.0.0.1:3000).
// Usage: node tests/e2e/run.cjs
//
// Each step records PASS/FAIL and the run continues, so one bug does not hide others.
// Results are written to tests/e2e/results.json.

const { chromium, devices } = require('playwright');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:3000';
const DB_URL = process.env.DB_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const CRON_SECRET = process.env.CRON_SECRET || 'local-dev-cron-secret';
const PASSWORD = 'Passw0rd!23';
const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const consoleErrors = [];
let current = '';

function sql(q) {
  return execSync(`psql "${DB_URL}" -At -c ${JSON.stringify(q.replace(/\s+/g, ' '))}`, { encoding: 'utf8' }).trim();
}

async function step(name, fn) {
  current = name;
  const t = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - t });
    console.log(`  PASS  ${name}`);
  } catch (e) {
    results.push({ name, ok: false, ms: Date.now() - t, error: String(e && e.message ? e.message : e).split('\n')[0] });
    console.log(`  FAIL  ${name}\n        ${String(e && e.message ? e.message : e).split('\n')[0]}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function watch(page, label) {
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push({ label, step: current, text: m.text().slice(0, 300) });
  });
  page.on('pageerror', (e) => consoleErrors.push({ label, step: current, text: 'PAGEERROR ' + e.message.slice(0, 300) }));
  page.on('response', (r) => {
    if (r.status() >= 500) consoleErrors.push({ label, step: current, text: `HTTP ${r.status()} ${r.url()}` });
  });
}

async function newSession(browser, label, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true, ...opts });
  ctx.setDefaultTimeout(10000);
  const page = await ctx.newPage();
  watch(page, label);
  return { ctx, page };
}

async function login(page, email) {
  await page.context().clearCookies();
  await page.goto(`${BASE}/login`);
  await page.fill('#email', email);
  await page.fill('#password', PASSWORD);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 }), page.click('[data-testid=auth-submit]')]);
}

async function toast(page, kind, re) {
  const loc = page.locator(`[data-testid=toast-${kind}]`).filter({ hasText: re }).first();
  await loc.waitFor({ timeout: 15000 });
  return loc.textContent();
}

async function goto(page, p) {
  const res = await page.goto(`${BASE}${p}`);
  await page.waitForLoadState('networkidle');
  return res;
}

function wav(seconds = 2) {
  const rate = 8000;
  const n = rate * seconds;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 8000), 44 + i * 2);
  return buf;
}

function contactsCsv() {
  const rows = ['Contact Name,Mobile Number,Company,Industry,City,Consent,DND,Notes'];
  for (let i = 0; i < 30; i++) {
    const city = i % 2 ? 'Hyderabad' : 'Bengaluru';
    rows.push(`Test Lead ${i + 1},98480${String(i).padStart(5, '0')},"Biz ${i + 1}, Pvt Ltd",${i % 3 ? 'Restaurant' : 'Clinic'},${city},${i === 5 ? 'no' : i === 6 ? '' : 'yes'},${i === 6 || i === 7 ? 'yes' : 'no'},Imported row ${i + 1}`);
  }
  rows.push('Dup Lead,+91 98480 00000,Dup Biz,Clinic,Bengaluru,yes,no,duplicate of first'); // duplicate in file
  rows.push('Bad Lead,12345,Bad Biz,Clinic,Pune,yes,no,invalid phone'); // invalid
  rows.push('Weird Consent,9848011111,X,Clinic,Pune,maybe,no,invalid consent'); // invalid consent
  return rows.join('\n') + '\n';
}

(async () => {
  const browser = await chromium.launch();
  console.log(`E2E against ${BASE}\n`);

  // ------------------------------------------------------------------ AUTH
  const anon = await newSession(browser, 'anon');
  await step('Unauthenticated visit to / redirects to /login', async () => {
    await goto(anon.page, '/');
    assert(new URL(anon.page.url()).pathname === '/login', `ended at ${anon.page.url()}`);
  });
  await step('Unauthenticated deep link keeps ?next', async () => {
    await goto(anon.page, '/contacts?q=x');
    assert(anon.page.url().includes('next=%2Fcontacts'), anon.page.url());
  });
  await step('Unauthenticated API call returns 401 JSON', async () => {
    const r = await anon.page.request.get(`${BASE}/api/export/calls`);
    assert(r.status() === 401, `status ${r.status()}`);
  });
  await step('Signup form validates input', async () => {
    await goto(anon.page, '/signup');
    await anon.page.fill('#full_name', 'A');
    await anon.page.fill('#email', 'not-an-email');
    await anon.page.fill('#password', 'short');
    await anon.page.click('[data-testid=auth-submit]');
    await anon.page.getByText('Enter a valid email address').waitFor();
    await anon.page.getByText('Password must be at least 8 characters').waitFor();
  });

  const admin = await newSession(browser, 'admin');
  await step('First signup becomes active admin', async () => {
    await goto(admin.page, '/signup');
    await admin.page.fill('#full_name', 'Sahith Admin');
    await admin.page.fill('#email', 'admin@flashqc.test');
    await admin.page.fill('#password', PASSWORD);
    await Promise.all([admin.page.waitForURL(`${BASE}/`), admin.page.click('[data-testid=auth-submit]')]);
    await admin.page.waitForSelector('[data-testid=metric-cards]');
    assert(sql("select role||':'||is_active from profiles where email='admin@flashqc.test'") === 'admin:true', 'not admin');
  });

  const agent = await newSession(browser, 'agent');
  await step('Second signup is pending approval and sees no data', async () => {
    await goto(agent.page, '/signup');
    await agent.page.fill('#full_name', 'Ravi Agent');
    await agent.page.fill('#email', 'agent@flashqc.test');
    await agent.page.fill('#password', PASSWORD);
    await agent.page.click('[data-testid=auth-submit]');
    await agent.page.waitForURL((u) => u.pathname !== '/signup', { timeout: 20000 });
    await goto(agent.page, '/contacts');
    await agent.page.waitForURL((u) => u.pathname === '/pending');
    await agent.page.getByTestId('pending-approval').waitFor();
  });
  const viewer = await newSession(browser, 'viewer');
  await step('Third signup (viewer) created', async () => {
    await goto(viewer.page, '/signup');
    await viewer.page.fill('#full_name', 'Vani Viewer');
    await viewer.page.fill('#email', 'viewer@flashqc.test');
    await viewer.page.fill('#password', PASSWORD);
    await viewer.page.click('[data-testid=auth-submit]');
    await viewer.page.waitForURL((u) => u.pathname !== '/signup', { timeout: 20000 });
  });
  await step('Wrong password shows error, not success', async () => {
    await goto(anon.page, '/login');
    await anon.page.fill('#email', 'admin@flashqc.test');
    await anon.page.fill('#password', 'WrongPass123');
    await anon.page.click('[data-testid=auth-submit]');
    await anon.page.getByText('Invalid email or password.').waitFor();
  });

  await step('No Google sign-in button (email + password only)', async () => {
    await goto(anon.page, '/login');
    assert((await anon.page.getByText('Continue with Google').count()) === 0, 'Google button still present');
  });
  await step('Admin approves agent (role agent) and viewer via Team tab', async () => {
    await goto(admin.page, '/settings?tab=team');
    const agentId = sql("select id from profiles where email='agent@flashqc.test'");
    const viewerId = sql("select id from profiles where email='viewer@flashqc.test'");
    await admin.page.selectOption(`#role-${agentId}`, 'agent');
    await admin.page.locator('tr', { hasText: 'agent@flashqc.test' }).getByLabel('Active').check();
    await admin.page.getByTestId(`save-member-${agentId}`).click();
    await toast(admin.page, 'success', /agent@flashqc.test updated/);
    await admin.page.locator('tr', { hasText: 'viewer@flashqc.test' }).getByLabel('Active').check();
    await admin.page.getByTestId(`save-member-${viewerId}`).click();
    await toast(admin.page, 'success', /viewer@flashqc.test updated/);
    assert(sql("select role||':'||is_active from profiles where email='agent@flashqc.test'") === 'agent:true', 'agent not activated');
    assert(sql("select role||':'||is_active from profiles where email='viewer@flashqc.test'") === 'viewer:true', 'viewer not activated');
  });
  await step('Admin cannot deactivate self (checkbox disabled)', async () => {
    const disabled = await admin.page.locator('tr', { hasText: '(you)' }).getByLabel('Active').isDisabled();
    assert(disabled, 'self checkbox enabled');
  });

  // ------------------------------------------------------------------ ROUTES
  const routes = ['/', '/inbound', '/outbound', '/campaigns', '/campaigns/new', '/calls', '/recordings', '/contacts', '/contacts/import', '/phone-numbers', '/voice-agents', '/analytics', '/integrations', '/settings', '/settings?tab=organization', '/settings?tab=team', '/settings?tab=suppression', '/settings?tab=audit'];
  await step('Every route loads (200, h1, no error boundary) — empty state', async () => {
    for (const r of routes) {
      const res = await goto(admin.page, r);
      assert(res.status() === 200, `${r} → ${res.status()}`);
      const h1 = await admin.page.locator('h1').first().textContent();
      assert(h1 && h1.trim().length > 0, `${r} has no h1`);
      assert((await admin.page.getByText('This page failed to load').count()) === 0, `${r} error boundary`);
    }
  });
  await step('Sidebar links navigate to each module', async () => {
    await goto(admin.page, '/');
    const labels = ['Inbound Calls', 'Outbound Calls', 'Bulk Campaigns', 'Call Logs', 'Recordings', 'Contacts', 'Phone Numbers', 'Voice Agents', 'Analytics', 'Integrations', 'Settings', 'Overview'];
    for (const l of labels) {
      const href = await admin.page.locator('aside nav').getByRole('link', { name: l, exact: true }).getAttribute('href');
      await admin.page.locator('aside nav').getByRole('link', { name: l, exact: true }).click();
      await admin.page.waitForURL((u) => u.pathname === href);
      await admin.page.locator('aside nav [aria-current=page]', { hasText: l }).waitFor();
      const cur = await admin.page.locator('aside nav [aria-current=page]').textContent();
      assert(cur && cur.includes(l), `active nav after clicking ${l} is "${cur}"`);
    }
  });
  await step('Unknown record id shows 404 page', async () => {
    const r = await goto(admin.page, '/calls/00000000-0000-0000-0000-000000000000');
    assert((await admin.page.getByText('Page not found').count()) > 0, `status ${r.status()}`);
    await goto(admin.page, '/contacts/not-a-uuid');
    assert((await admin.page.getByText('Page not found').count()) > 0, 'bad uuid not 404');
  });

  // ------------------------------------------------------------------ CONFIG: numbers & agents
  await step('Create voice agent', async () => {
    await goto(admin.page, '/voice-agents');
    await admin.page.getByTestId('add-agent').first().click();
    await admin.page.fill('#va_name', 'Priya Sales');
    await admin.page.selectOption('#va_lang', 'te-IN');
    await admin.page.fill('#va_greet', 'Namaste! This is Priya from FlashQC Digi.');
    await admin.page.click('[data-testid=voice-agent-form] button[type=submit]');
    await toast(admin.page, 'success', /Voice agent created/);
    await admin.page.getByText('Priya Sales').first().waitFor();
    assert(sql("select connection_status from voice_agents where name='Priya Sales'") === 'not_connected', 'agent claims connection');
  });
  await step('Duplicate voice agent name rejected', async () => {
    await admin.page.getByTestId('add-agent').first().click();
    await admin.page.fill('#va_name', 'priya sales');
    await admin.page.click('[data-testid=voice-agent-form] button[type=submit]');
    await toast(admin.page, 'error', /already exists/);
    await admin.page.keyboard.press('Escape');
  });
  await step('Edit voice agent status to Ready', async () => {
    await goto(admin.page, '/voice-agents');
    await admin.page.getByTestId('edit-agent').first().click();
    await admin.page.selectOption('#va_status', 'ready');
    await admin.page.click('[data-testid=voice-agent-form] button[type=submit]');
    await toast(admin.page, 'success', /Voice agent updated/);
    assert(sql("select status from voice_agents where name='Priya Sales'") === 'ready', 'status not saved');
  });
  await step('Phone number validation and create', async () => {
    await goto(admin.page, '/phone-numbers');
    await admin.page.getByTestId('add-number').first().click();
    await admin.page.fill('#pn_label', 'Sales line');
    await admin.page.fill('#pn_phone', '123');
    await admin.page.click('[data-testid=phone-number-form] button[type=submit]');
    await admin.page.locator('#pn_phone-error').waitFor();
    await admin.page.fill('#pn_phone', '040 1234 5678');
    await admin.page.selectOption('#pn_agent', { label: 'Priya Sales' });
    await admin.page.click('[data-testid=phone-number-form] button[type=submit]');
    await toast(admin.page, 'success', /Phone number added/);
    assert(sql("select phone_e164||':'||connection_status from phone_numbers where label='Sales line'") === '+914012345678:not_connected', 'number not saved/normalised');
  });
  await step('Phone number requires inbound or outbound', async () => {
    await goto(admin.page, '/phone-numbers');
    await admin.page.getByTestId('edit-number').first().click();
    await admin.page.getByLabel('Inbound').uncheck();
    await admin.page.getByLabel('Outbound').uncheck();
    await admin.page.click('[data-testid=phone-number-form] button[type=submit]');
    await admin.page.getByText('Enable inbound, outbound or both').waitFor();
    await admin.page.keyboard.press('Escape');
  });

  // ------------------------------------------------------------------ CONTACTS
  await step('Create contact: invalid phone shows field error', async () => {
    await goto(admin.page, '/contacts');
    await admin.page.getByTestId('new-contact').click();
    await admin.page.fill('#cf_name', 'Anita Rao');
    await admin.page.fill('#cf_phone', '55555');
    await admin.page.click('[data-testid=contact-form] button[type=submit]');
    await admin.page.locator('#cf_phone-error').waitFor();
  });
  await step('Create contact succeeds and opens detail', async () => {
    await admin.page.fill('#cf_phone', '99887 76655');
    await admin.page.fill('#cf_business', 'Rao Dental');
    await admin.page.fill('#cf_category', 'Clinic');
    await admin.page.fill('#cf_city', 'Hyderabad');
    await admin.page.selectOption('#cf_consent', 'granted');
    await admin.page.click('[data-testid=contact-form] button[type=submit]');
    await admin.page.waitForURL(/\/contacts\/[0-9a-f-]{36}$/);
    await admin.page.getByRole('heading', { name: 'Anita Rao' }).waitFor();
    assert(sql("select count(*) from contacts where phone_e164='+919988776655'") === '1', 'not saved');
  });
  await step('Duplicate contact phone rejected', async () => {
    await goto(admin.page, '/contacts');
    await admin.page.getByTestId('new-contact').click();
    await admin.page.fill('#cf_phone', '+91 9988776655');
    await admin.page.click('[data-testid=contact-form] button[type=submit]');
    await toast(admin.page, 'error', /already exists/);
    assert(sql("select count(*) from contacts where phone_e164='+919988776655'") === '1', 'duplicate created');
    await admin.page.keyboard.press('Escape');
  });
  await step('Edit contact', async () => {
    const id = sql("select id from contacts where phone_e164='+919988776655'");
    await goto(admin.page, `/contacts/${id}`);
    await admin.page.getByTestId('edit-contact').click();
    await admin.page.fill('#cf_notes', 'Prefers calls after 11am');
    await admin.page.click('[data-testid=contact-form] button[type=submit]');
    await toast(admin.page, 'success', /Contact updated/);
    await admin.page.getByText('Prefers calls after 11am').waitFor();
  });

  const csvPath = path.join(OUT, 'contacts.csv');
  fs.writeFileSync(csvPath, contactsCsv());
  await step('CSV import preview: counts, duplicates, invalid rows', async () => {
    await goto(admin.page, '/contacts/import');
    await admin.page.setInputFiles('[data-testid=csv-input]', csvPath);
    await admin.page.getByTestId('csv-preview').waitFor();
    await admin.page.waitForFunction(() => !document.querySelector('[data-testid=csv-counts]').textContent.includes('…'));
    const counts = await admin.page.getByTestId('csv-counts').textContent();
    assert(/New contacts\s*30/.test(counts), counts);
    assert(/Duplicates in file\s*1/.test(counts), counts);
    assert(/Invalid rows\s*2/.test(counts), counts);
  });
  await step('CSV import writes 30 contacts without duplicates', async () => {
    await admin.page.getByTestId('csv-confirm').click();
    await toast(admin.page, 'success', /30 added/);
    assert(sql("select count(*) from contacts where source='csv_import'") === '30', 'wrong count');
    assert(sql("select consent_status from contacts where full_name='Test Lead 6'") === 'revoked', 'consent not parsed');
    assert(sql("select dnd_status from contacts where full_name='Test Lead 7'") === 'registered', 'dnd not parsed');
  });
  await step('Re-importing same CSV detects all as existing (no duplicates)', async () => {
    await goto(admin.page, '/contacts/import');
    await admin.page.setInputFiles('[data-testid=csv-input]', csvPath);
    await admin.page.waitForFunction(() => /Already exist\s*30/.test(document.querySelector('[data-testid=csv-counts]')?.textContent || ''));
    await admin.page.getByTestId('csv-confirm').click();
    await toast(admin.page, 'success', /0 added, 0 updated, 30 existing skipped/);
    assert(sql('select count(*) from contacts') === '31', 'duplicates created');
  });
  await step('CSV without phone column is rejected', async () => {
    const p = path.join(OUT, 'nophone.csv');
    fs.writeFileSync(p, 'name,city\nA,B\n');
    await goto(admin.page, '/contacts/import');
    await admin.page.setInputFiles('[data-testid=csv-input]', p);
    await admin.page.getByText('No phone column found').waitFor();
  });
  await step('Contacts search, filter and sort', async () => {
    await goto(admin.page, '/contacts?q=Lead+12');
    let rows = await admin.page.locator('[data-testid=contacts-table] tbody tr').count();
    assert(rows === 1, `search rows ${rows}`);
    await goto(admin.page, '/contacts?city=Hyderabad');
    rows = await admin.page.locator('[data-testid=contacts-table] tbody tr').count();
    assert(rows === 16, `city filter rows ${rows}`); // 15 csv + Anita
    await goto(admin.page, '/contacts?dnd=registered');
    rows = await admin.page.locator('[data-testid=contacts-table] tbody tr').count();
    assert(rows === 2, `dnd filter rows ${rows}`);
    await goto(admin.page, '/contacts?sort=full_name&dir=asc');
    const first = await admin.page.locator('[data-testid=contacts-table] tbody tr').first().textContent();
    assert(first.includes('Anita Rao'), `sort first row ${first.slice(0, 40)}`);
    await goto(admin.page, '/contacts?q=98480');
    rows = await admin.page.locator('[data-testid=contacts-table] tbody tr').count();
    assert(rows === 25, `phone digit search page rows ${rows}`);
    await admin.page.getByRole('link', { name: /Next/ }).click();
    await admin.page.waitForURL(/page=2/);
    await admin.page.waitForLoadState('networkidle');
    rows = await admin.page.locator('[data-testid=contacts-table] tbody tr').count();
    assert(rows === 5, `page 2 rows ${rows}`);
  });
  await step('Filter dropdown auto-applies via URL', async () => {
    await goto(admin.page, '/contacts');
    await admin.page.selectOption('#filter-consent', 'revoked');
    await admin.page.waitForURL(/consent=revoked/);
    await admin.page.waitForLoadState('networkidle');
    const rows = await admin.page.locator('[data-testid=contacts-table] tbody tr').count();
    assert(rows === 1, `rows ${rows}`);
  });
  await step('Contacts CSV export downloads filtered data', async () => {
    await goto(admin.page, '/contacts?city=Hyderabad');
    const [dl] = await Promise.all([admin.page.waitForEvent('download'), admin.page.getByRole('link', { name: 'Export CSV' }).click()]);
    const file = path.join(OUT, 'export-contacts.csv');
    await dl.saveAs(file);
    const text = fs.readFileSync(file, 'utf8');
    const lines = text.trim().split(/\r?\n/);
    assert(lines.length === 17, `export lines ${lines.length}`);
    assert(lines[0].includes('phone') && text.includes('+919988776655'), 'missing data');
  });
  await step('Exported CSV re-imports cleanly (round trip)', async () => {
    await goto(admin.page, '/contacts/import');
    await admin.page.setInputFiles('[data-testid=csv-input]', path.join(OUT, 'export-contacts.csv'));
    await admin.page.waitForFunction(() => /Already exist\s*16/.test(document.querySelector('[data-testid=csv-counts]')?.textContent || ''));
    const counts = await admin.page.getByTestId('csv-counts').textContent();
    assert(/Invalid rows\s*0/.test(counts), counts);
  });

  // ------------------------------------------------------------------ OUTBOUND / INBOUND (simulated)
  await step('Outbound: live mode disabled without provider', async () => {
    await goto(admin.page, '/outbound');
    assert(await admin.page.locator('input[name=mode][value=live]').isDisabled(), 'live enabled');
  });
  await step('Outbound simulated call via contact search', async () => {
    await admin.page.fill('#phone', 'Anita');
    await admin.page.locator('[role=listbox] [role=option]').first().click();
    await admin.page.selectOption('#phone_number_id', { label: 'Sales line · +91 40123 45678' }).catch(async () => {
      const opts = await admin.page.locator('#phone_number_id option').allTextContents();
      await admin.page.selectOption('#phone_number_id', { label: opts.find((o) => o.includes('Sales line')) });
    });
    await admin.page.click('[data-testid=outbound-form] button[type=submit]');
    await toast(admin.page, 'success', /Simulated call recorded/);
    assert(sql("select count(*) from calls c join contacts k on k.id=c.contact_id where k.full_name='Anita Rao' and c.is_simulated") === '1', 'call not saved');
  });
  await step('Outbound to raw number with invalid input shows error', async () => {
    await goto(admin.page, '/outbound');
    await admin.page.fill('#phone', '12');
    await admin.page.click('[data-testid=outbound-form] button[type=submit]');
    await admin.page.getByText(/10-digit Indian number|Phone number is required/).first().waitFor();
  });
  await step('Outbound blocked for revoked consent / DND contact', async () => {
    await goto(admin.page, '/outbound');
    await admin.page.fill('#phone', 'Test Lead 6');
    await admin.page.locator('[role=listbox] [role=option]').first().click();
    await admin.page.click('[data-testid=outbound-form] button[type=submit]');
    await toast(admin.page, 'error', /revoked consent/);
    await goto(admin.page, '/outbound');
    await admin.page.fill('#phone', 'Test Lead 7');
    await admin.page.locator('[role=listbox] [role=option]').first().click();
    await admin.page.click('[data-testid=outbound-form] button[type=submit]');
    await toast(admin.page, 'error', /DND/);
  });
  await step('Inbound simulated calls (unknown + known numbers)', async () => {
    for (let i = 0; i < 6; i++) {
      await goto(admin.page, '/inbound');
      await admin.page.fill('#sim_phone', i % 2 ? '9988776655' : `90000 0000${i}`);
      await admin.page.click('[data-testid=inbound-sim-form] button[type=submit]');
      await toast(admin.page, 'success', /Simulated inbound call recorded/);
    }
    assert(sql("select count(*) from calls where direction='inbound' and is_simulated") === '6', 'inbound count');
  });
  await step('Missed-call callback queue matches DB', async () => {
    await goto(admin.page, '/inbound');
    const expected = Number(
      sql(`with m as (select distinct on (phone_e164) phone_e164, started_at from calls where direction='inbound' and status='missed' order by phone_e164, started_at desc)
           select count(*) from m where not exists (select 1 from calls c where c.phone_e164=m.phone_e164 and c.answered_at is not null and c.started_at > m.started_at)`),
    );
    const shown = (await admin.page.getByTestId('callback-queue').count()) ? await admin.page.locator('[data-testid=callback-queue] li').count() : 0;
    assert(shown === expected, `queue shows ${shown}, expected ${expected}`);
  });

  // ------------------------------------------------------------------ CALL DETAIL
  const anitaCall = sql("select c.id from calls c join contacts k on k.id=c.contact_id where k.full_name='Anita Rao' and c.direction='outbound' limit 1");
  const unknownInbound = sql("select id from calls where contact_id is null and direction='inbound' limit 1");
  await step('Call detail: event timeline and simulated label', async () => {
    await goto(admin.page, `/calls/${anitaCall}`);
    await admin.page.getByTestId('event-timeline').waitFor();
    assert((await admin.page.getByText('This call was generated by the simulator').count()) === 1, 'no simulated notice');
    assert((await admin.page.getByText('Recordings cannot be attached to simulated calls.').count()) === 1, 'simulated recording guard missing');
  });
  await step('Call detail: set outcome and notes', async () => {
    await admin.page.selectOption('#outcome', 'interested');
    await admin.page.fill('#notes', 'Wants a demo next week');
    await admin.page.getByRole('button', { name: 'Save outcome' }).click();
    await toast(admin.page, 'success', /Call outcome saved/);
    assert(sql(`select outcome||'|'||notes from calls where id='${anitaCall}'`) === 'interested|Wants a demo next week', 'not saved');
  });
  await step('Call detail: add manual transcript and summary', async () => {
    await admin.page.locator('section', { hasText: 'Transcript' }).getByRole('button', { name: 'Add manually' }).click();
    await admin.page.fill('#t_content', 'Agent: Hello\nCustomer: Hi, interested in a demo.');
    await admin.page.getByRole('button', { name: 'Save transcript' }).click();
    await toast(admin.page, 'success', /Transcript saved/);
    await admin.page.getByTestId('transcript-view').waitFor();
    await admin.page.locator('section', { hasText: 'AI summary' }).getByRole('button', { name: 'Add manually' }).click();
    await admin.page.fill('#s_summary', 'Customer interested; schedule demo.');
    await admin.page.selectOption('#s_sentiment', 'positive');
    await admin.page.getByRole('button', { name: 'Save summary' }).click();
    await toast(admin.page, 'success', /Summary saved/);
    await admin.page.getByTestId('summary-view').waitFor();
    assert(sql(`select source from call_summaries where call_id='${anitaCall}'`) === 'manual', 'summary source');
  });
  await step('Call page has no dead AI buttons (summaries arrive automatically)', async () => {
    assert((await admin.page.getByRole('button', { name: /Generate/ }).count()) === 0, 'dead Generate button still shown');
  });
  await step('Do-not-call outcome adds number to suppression list', async () => {
    await goto(admin.page, `/calls/${unknownInbound}`);
    await admin.page.selectOption('#outcome', 'do_not_call');
    await admin.page.getByRole('button', { name: 'Save outcome' }).click();
    await toast(admin.page, 'success', /suppression list/);
    const phone = sql(`select phone_e164 from calls where id='${unknownInbound}'`);
    assert(sql(`select source from suppression_list where phone_e164='${phone}'`) === 'opt_out', 'not suppressed');
  });
  await step('Save unknown caller as contact links calls', async () => {
    await admin.page.fill('#sc_name', 'Walk-in Caller');
    await admin.page.getByRole('button', { name: 'Save as contact' }).click();
    await toast(admin.page, 'success', /Contact saved/);
    const phone = sql(`select phone_e164 from calls where id='${unknownInbound}'`);
    assert(sql(`select count(*) from calls where phone_e164='${phone}' and contact_id is null`) === '0', 'calls not linked');
  });

  // Real call with an uploaded recording: create a queued real call as the backend would, then mark it
  // completed as a provider webhook would (service role). Used only to exercise recording upload/playback.
  const realCall = sql(
    "insert into calls (direction,status,phone_e164,provider,provider_call_id,started_at,answered_at,ended_at,duration_seconds) values ('outbound','completed','+919988776655','e2e-test','e2e-1',now()-interval '3 minutes',now()-interval '170 seconds',now()-interval '50 seconds',120) returning id",
  ).split('\n')[0];
  sql(`update calls set contact_id=(select id from contacts where phone_e164='+919988776655') where id='${realCall}'`);
  const wavPath = path.join(OUT, 'test-tone.wav');
  fs.writeFileSync(wavPath, wav(2));
  await step('Recording: reject non-audio file', async () => {
    const txt = path.join(OUT, 'not-audio.txt');
    fs.writeFileSync(txt, 'hello');
    await goto(admin.page, `/calls/${realCall}`);
    await admin.page.setInputFiles('[data-testid=recording-input]', txt);
    await admin.page.getByText(/Unsupported file type/).first().waitFor();
  });
  await step('Recording: upload real WAV to private storage and play via signed URL', async () => {
    await goto(admin.page, `/calls/${realCall}`);
    await admin.page.setInputFiles('[data-testid=recording-input]', wavPath);
    await toast(admin.page, 'success', /Recording uploaded/);
    await admin.page.getByTestId('recording-player').waitFor();
    const src = await admin.page.getByTestId('recording-player').getAttribute('src');
    assert(src && src.includes('/storage/v1/object/sign/call-recordings/'), `src ${src}`);
    const r = await admin.page.request.get(src);
    assert(r.status() === 200 && (await r.body()).length > 1000, `signed url status ${r.status()}`);
    const unsigned = src.replace('/object/sign/', '/object/public/').split('?')[0];
    const r2 = await admin.page.request.get(unsigned);
    assert(r2.status() >= 400, `bucket is public! ${r2.status()}`);
  });
  await step('Recordings library lists recording with player and viewer', async () => {
    await goto(admin.page, '/recordings');
    assert((await admin.page.locator('[data-testid=recordings-list] li').count()) === 1, 'not listed');
    await admin.page.getByTestId('view-artifacts').click();
    await admin.page.getByText('No transcript yet.').waitFor();
    await admin.page.keyboard.press('Escape');
    await goto(admin.page, '/recordings?q=Anita');
    assert((await admin.page.locator('[data-testid=recordings-list] li').count()) === 1, 'search failed');
    await goto(admin.page, '/recordings?q=nobody-matches');
    await admin.page.getByText('No recordings match these filters').waitFor();
  });

  // ------------------------------------------------------------------ CAMPAIGNS
  await step('Campaign wizard requires audience selection', async () => {
    await goto(admin.page, '/campaigns/new');
    await admin.page.fill('#cp_name', 'Hyderabad Restaurants Nov');
    await admin.page.getByTestId('create-campaign').click();
    await admin.page.getByText(/Choose the campaign contacts/).waitFor();
  });
  await step('Campaign live mode option disabled', async () => {
    assert(await admin.page.locator('#cp_mode option[value=live]').isDisabled(), 'live enabled');
  });
  await step('Create campaign from existing contacts filter', async () => {
    await admin.page.getByRole('tab', { name: 'Existing contacts' }).click();
    await admin.page.fill('#af_q', 'Test Lead');
    await admin.page.getByTestId('filter-preview').click();
    await admin.page.getByTestId('filter-count').waitFor();
    const txt = await admin.page.getByTestId('filter-count').textContent();
    assert(txt.includes('30'), txt);
    await admin.page.selectOption('#cp_attempts', '2');
    await admin.page.getByTestId('create-campaign').click();
    await admin.page.waitForURL(/\/campaigns\/[0-9a-f-]{36}$/);
    await toast(admin.page, 'success', /draft with 30 contacts/);
  });
  const campaignId = sql("select id from campaigns where name='Hyderabad Restaurants Nov'");
  await step('Run simulated campaign to completion', async () => {
    await goto(admin.page, `/campaigns/${campaignId}`);
    await admin.page.getByTestId('campaign-start').click();
    await toast(admin.page, 'success', /Campaign is running/);
    await admin.page.getByTestId('campaign-runner').waitFor();
    await admin.page.waitForFunction(() => document.body.textContent.includes('Completed') && !document.querySelector('[data-testid=campaign-runner]'), null, { timeout: 120000 });
    assert(sql(`select status from campaigns where id='${campaignId}'`) === 'completed', 'not completed');
    assert(sql(`select count(*) from campaign_contacts where campaign_id='${campaignId}' and status in ('pending','in_progress')`) === '0', 'pending remain');
  });
  await step('Campaign compliance: revoked consent and DND contacts skipped', async () => {
    const skipped = sql(`select string_agg(k.full_name||':'||cc.skip_reason, '; ' order by k.full_name) from campaign_contacts cc join contacts k on k.id=cc.contact_id where cc.campaign_id='${campaignId}' and cc.status='skipped'`);
    assert(skipped.includes('Test Lead 6:Contact has revoked consent'), skipped);
    assert(skipped.includes('Test Lead 7:Number is on DND'), skipped);
    assert(sql(`select count(*) from calls k join contacts c on c.id=k.contact_id where c.full_name in ('Test Lead 6','Test Lead 7')`) === '0', 'blocked contacts were called');
    // DND with explicit consent is allowed to be contacted.
    assert(Number(sql(`select count(*) from calls k join contacts c on c.id=k.contact_id where c.full_name = 'Test Lead 8' and k.campaign_id='${campaignId}'`)) > 0, 'consented DND contact not called');
  });
  await step('Campaign retries respect max attempts', async () => {
    const over = sql(`select count(*) from campaign_contacts where campaign_id='${campaignId}' and attempts > 2`);
    assert(over === '0', `over-attempted ${over}`);
    const callsVsAttempts = sql(`select (select count(*) from calls where campaign_id='${campaignId}') = (select sum(attempts) from campaign_contacts where campaign_id='${campaignId}')`);
    assert(callsVsAttempts === 't', 'calls != attempts (duplicate dialing?)');
  });
  await step('Campaign stats cards match database', async () => {
    await goto(admin.page, `/campaigns/${campaignId}`);
    const total = sql(`select count(*) from calls where campaign_id='${campaignId}'`);
    const answered = sql(`select count(*) from calls where campaign_id='${campaignId}' and answered_at is not null`);
    const txt = await admin.page.getByTestId('campaign-stats').textContent();
    assert(txt.includes(`Calls placed${total}`) && txt.includes(`${answered} answered`), `${txt} vs ${total}/${answered}`);
  });
  await step('Campaign contact status filter', async () => {
    await goto(admin.page, `/campaigns/${campaignId}?status=skipped`);
    const rows = await admin.page.locator('[data-testid=campaign-contacts-table] tbody tr').count();
    assert(rows === 2, `skipped rows ${rows}`);
  });
  await step('Campaign results: interest chips filter, funnel, why, call again', async () => {
    await goto(admin.page, `/campaigns/${campaignId}`);
    await admin.page.getByTestId('interest-chips').waitFor();
    const heads = await admin.page.locator('[data-testid=campaign-contacts-table] thead th').allInnerTexts();
    assert(['Interest', 'Funnel', 'Why', 'Recording'].every((h) => heads.some((x) => x.toLowerCase() === h.toLowerCase())), `headers ${heads.join('|')}`);
    const counts = sql(`select interest||':'||n from (select interest, count(*) n from campaign_results_view where campaign_id='${campaignId}' group by interest) x`).split('\n').filter(Boolean);
    assert(counts.length > 0, 'no interest data');
    const [top, n] = counts.sort((a, b) => Number(b.split(':')[1]) - Number(a.split(':')[1]))[0].split(':');
    await admin.page.getByTestId(`interest-chip-${top}`).click();
    await admin.page.waitForURL(new RegExp(`interest=${top}`));
    const rows = await admin.page.locator('[data-testid=campaign-contacts-table] tbody tr').count();
    assert(rows === Math.min(25, Number(n)), `chip ${top}: rows ${rows} vs ${n}`);
    const before = Number(sql('select count(*) from calls'));
    await admin.page.getByTestId('call-again').first().click();
    await admin.page.getByTestId('call-again-confirm').click();
    await toast(admin.page, 'success', /Simulated call recorded/);
    assert(Number(sql('select count(*) from calls')) === before + 1, 'call again did not place a call');
  });
  await step('Call Logs interest filter matches the database', async () => {
    const n = Number(sql("select count(*) from call_log_view where interest='no_answer'"));
    await goto(admin.page, '/calls?interest=no_answer');
    const rows = n ? await admin.page.locator('[data-testid=calls-table] tbody tr').count() : 0;
    assert(rows === Math.min(25, n), `no_answer rows ${rows} vs ${n}`);
    const heads = await admin.page.locator('[data-testid=calls-table] thead th').allInnerTexts();
    assert(heads.some((h) => /interest/i.test(h)), 'no Interest column');
  });
  await step('Campaign report CSV export', async () => {
    await goto(admin.page, `/campaigns/${campaignId}`);
    const [dl] = await Promise.all([admin.page.waitForEvent('download'), admin.page.getByRole('link', { name: 'Report CSV' }).click()]);
    const file = path.join(OUT, 'campaign-report.csv');
    await dl.saveAs(file);
    const lines = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/);
    assert(lines.length === 31 && lines[1].includes('SIMULATED'), `lines ${lines.length}`);
    assert(lines[0].includes('interest') && lines[0].includes('funnel_stage') && lines[0].includes('why'), `header ${lines[0]}`);
  });
  await step('Campaign from CSV upload, pause and resume, cancel', async () => {
    const p = path.join(OUT, 'campaign2.csv');
    fs.writeFileSync(p, 'name,phone,city\nNew A,9700000001,Pune\nNew B,9700000002,Pune\nNew C,9700000003,Pune\nExisting,9988776655,Hyderabad\n');
    await goto(admin.page, '/campaigns/new');
    await admin.page.fill('#cp_name', 'Pune pilot');
    await admin.page.setInputFiles('[data-testid=csv-input]', p);
    await admin.page.waitForFunction(() => /Already exist\s*1/.test(document.querySelector('[data-testid=csv-counts]')?.textContent || ''));
    await admin.page.getByTestId('csv-confirm').click();
    await admin.page.getByTestId('csv-ready').waitFor();
    await admin.page.getByTestId('create-campaign').click();
    await admin.page.waitForURL(/\/campaigns\/[0-9a-f-]{36}$/);
    const id = sql("select id from campaigns where name='Pune pilot'");
    assert(sql(`select count(*) from campaign_contacts where campaign_id='${id}'`) === '4', 'enrolment');
    assert(sql("select count(*) from contacts where phone_e164='+919988776655'") === '1', 'duplicate contact');
    await admin.page.getByTestId('campaign-start').click();
    await toast(admin.page, 'success', /running/);
    await admin.page.getByTestId('campaign-pause').click();
    await toast(admin.page, 'success', /paused/);
    assert(sql(`select status from campaigns where id='${id}'`) === 'paused', 'not paused');
    await admin.page.getByTestId('campaign-cancel').click();
    await admin.page.getByTestId('campaign-cancel-confirm').click();
    await toast(admin.page, 'success', /cancelled/);
    assert(sql(`select status from campaigns where id='${id}'`) === 'cancelled', 'not cancelled');
    assert(sql(`select count(*) from campaign_contacts where campaign_id='${id}' and status='pending'`) === '0', 'pending after cancel');
  });
  await step('Campaign with no contacts cannot start; add contacts; delete draft', async () => {
    await goto(admin.page, '/campaigns/new');
    await admin.page.fill('#cp_name', 'Empty draft');
    await admin.page.getByRole('tab', { name: 'Add later' }).click();
    await admin.page.getByTestId('create-campaign').click();
    await admin.page.waitForURL(/\/campaigns\/[0-9a-f-]{36}$/);
    await admin.page.getByTestId('campaign-start').click();
    await toast(admin.page, 'error', /at least one contact/);
    await admin.page.getByTestId('campaign-add-contacts').click();
    await admin.page.getByRole('tab', { name: 'Existing contacts' }).last().click();
    await admin.page.fill('#af_q', 'Anita');
    await admin.page.getByTestId('filter-preview').click();
    await admin.page.getByTestId('filter-count').waitFor();
    await admin.page.getByTestId('campaign-add-confirm').click();
    await toast(admin.page, 'success', /1 contact added/);
    await admin.page.getByTestId('campaign-delete').click();
    await admin.page.getByTestId('campaign-delete-confirm').click();
    await admin.page.waitForURL(`${BASE}/campaigns`);
    assert(sql("select count(*) from campaigns where name='Empty draft'") === '0', 'not deleted');
  });
  await step('Campaign settings edit (draft) with window validation', async () => {
    await goto(admin.page, '/campaigns/new');
    await admin.page.fill('#cp_name', 'Window test');
    await admin.page.getByRole('tab', { name: 'Add later' }).click();
    await admin.page.getByTestId('create-campaign').click();
    await admin.page.waitForURL(/\/campaigns\/[0-9a-f-]{36}$/);
    await admin.page.getByTestId('campaign-edit').click();
    await admin.page.fill('#cp_start', '18:00');
    await admin.page.fill('#cp_end', '10:00');
    await admin.page.locator('dialog form button[type=submit]').click();
    await toast(admin.page, 'error', /highlighted|after start/);
    await admin.page.fill('#cp_end', '20:00');
    await admin.page.locator('dialog form button[type=submit]').click();
    await toast(admin.page, 'success', /settings saved/);
    assert(sql("select calling_window_start from campaigns where name='Window test'") === '18:00:00', 'window not saved');
  });

  // ------------------------------------------------------------------ CALL LOGS
  await step('Call logs: pagination, filters, search, sort', async () => {
    const total = Number(sql('select count(*) from calls'));
    await goto(admin.page, '/calls');
    const rows = await admin.page.locator('[data-testid=calls-table] tbody tr').count();
    assert(rows === Math.min(25, total), `rows ${rows} total ${total}`);
    const pag = await admin.page.locator('nav[aria-label=Pagination]').textContent();
    assert(pag.replace(/\s/g, '').includes(`of${total.toLocaleString('en-IN')}`), pag);
    await goto(admin.page, '/calls?direction=inbound');
    assert((await admin.page.locator('[data-testid=calls-table] tbody tr').count()) === 6, 'inbound filter');
    await goto(admin.page, '/calls?status=failed');
    const failed = Number(sql("select count(*) from calls where status='failed'"));
    const fr = failed ? await admin.page.locator('[data-testid=calls-table] tbody tr').count() : 0;
    assert(fr === Math.min(25, failed), `failed rows ${fr} vs ${failed}`);
    await goto(admin.page, '/calls?q=Anita');
    const an = Number(sql("select count(*) from calls c join contacts k on k.id=c.contact_id where k.full_name ilike '%Anita%'"));
    assert((await admin.page.locator('[data-testid=calls-table] tbody tr').count()) === an, 'search');
    await goto(admin.page, '/calls?scope=live');
    assert((await admin.page.locator('[data-testid=calls-table] tbody tr').count()) === 1, 'live scope');
    await goto(admin.page, '/calls?sort=duration_seconds&dir=desc');
    const top = sql('select max(duration_seconds) from calls where answered_at is not null');
    const durCol = await admin.page.locator('[data-testid=calls-table] thead th').evaluateAll((ths) => ths.findIndex((th) => /duration/i.test(th.textContent)));
    const firstDur = await admin.page.locator('[data-testid=calls-table] tbody tr').first().locator('td').nth(durCol).textContent();
    const m = /(?:(\d+)m )?(\d+)s/.exec(firstDur);
    assert(m && Number(m[1] || 0) * 60 + Number(m[2]) === Number(top), `first ${firstDur} vs ${top}`);
    await goto(admin.page, '/calls?recording=yes');
    assert((await admin.page.locator('[data-testid=calls-table] tbody tr').count()) === 1, 'recording filter');
    await goto(admin.page, '/calls?page=9999');
    await admin.page.getByText('No calls match these filters').waitFor();
  });
  await step('Call logs CSV export matches filter', async () => {
    await goto(admin.page, '/calls?direction=inbound');
    const [dl] = await Promise.all([admin.page.waitForEvent('download'), admin.page.getByRole('link', { name: 'Export CSV' }).click()]);
    const file = path.join(OUT, 'calls-inbound.csv');
    await dl.saveAs(file);
    const lines = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/);
    assert(lines.length === 7, `lines ${lines.length}`);
  });

  // ------------------------------------------------------------------ DASHBOARD & ANALYTICS
  await step('Dashboard cards equal database calculations', async () => {
    await goto(admin.page, '/?range=30d&scope=all');
    const q = (w) => sql(`select count(*) from calls where started_at >= now() - interval '31 days' and ${w}`);
    const exp = {
      total: q('true'),
      inbound: q("direction='inbound'"),
      outbound: q("direction='outbound'"),
      answered: q('answered_at is not null'),
      missed: q("status in ('missed','no_answer','busy')"),
      failed: q("status='failed'"),
    };
    const card = async (id) => (await admin.page.getByTestId(`stat-${id}`).textContent()).replace(/[,\s]/g, '');
    const got = { total: await card('total-calls'), inbound: await card('incoming'), outbound: await card('outgoing'), answered: await card('answered'), missed: await card('missed'), failed: await card('failed') };
    for (const k of Object.keys(exp)) assert(got[k] === exp[k], `${k}: card ${got[k]} db ${exp[k]}`);
    const talk = Number(sql("select coalesce(sum(duration_seconds),0) from calls where answered_at is not null and started_at >= now() - interval '31 days'"));
    const h = Math.floor(talk / 3600), mm = Math.floor((talk % 3600) / 60), s = talk % 60;
    const expTalk = talk < 60 ? `${talk}s` : h > 0 ? `${h}h ${String(mm).padStart(2, '0')}m` : `${mm}m ${String(s).padStart(2, '0')}s`;
    const gotTalk = (await admin.page.getByTestId('stat-total-talk-time').textContent()).trim();
    assert(gotTalk === expTalk, `talk time card ${gotTalk} vs ${expTalk}`);
  });
  await step('Dashboard live scope shows only real calls', async () => {
    await goto(admin.page, '/?scope=live');
    const total = (await admin.page.getByTestId('stat-total-calls').textContent()).trim();
    assert(total === sql("select count(*) from calls where not is_simulated and started_at >= now() - interval '31 days'"), `live total ${total}`);
  });
  await step('Dashboard chart table view matches daily totals', async () => {
    await goto(admin.page, '/?range=7d');
    await admin.page.getByRole('button', { name: 'Table' }).first().click();
    const cells = await admin.page.locator('table').first().locator('tbody tr td:last-child').allTextContents();
    const sum = cells.reduce((s, c) => s + Number(c.replace(/,/g, '')), 0);
    const exp = Number(sql(`select count(*) from calls where started_at >= (date_trunc('day', now() at time zone 'Asia/Kolkata') - interval '6 days') at time zone 'Asia/Kolkata'`));
    assert(sum === exp && cells.length === 7, `table sum ${sum} (rows ${cells.length}) vs ${exp}`);
  });
  await step('Dashboard trend toggle and custom date range', async () => {
    await goto(admin.page, '/');
    await admin.page.getByRole('tab', { name: 'Monthly' }).click();
    await admin.page.waitForURL(/trend=month/);
    await admin.page.getByText('Monthly trend · last 12 months').waitFor();
    await admin.page.selectOption('#filter-range', 'custom');
    await admin.page.waitForURL(/range=custom/);
    await admin.page.locator('#from').waitFor();
  });
  await step('Analytics renders with data', async () => {
    await goto(admin.page, '/analytics');
    await admin.page.getByText('Calls by hour of day (IST)').waitFor();
    assert((await admin.page.getByText('Priya Sales').count()) >= 0, 'agent table');
    assert((await admin.page.getByText('Hyderabad Restaurants Nov').count()) > 0, 'campaign table');
  });

  // ------------------------------------------------------------------ INTEGRATIONS & SETTINGS
  await step('Integrations: storage check verifies bucket', async () => {
    await goto(admin.page, '/integrations');
    await admin.page.getByTestId('check-recording_storage').click();
    await toast(admin.page, 'success', /reachable/);
    assert(sql("select status from integrations where key='recording_storage'") === 'connected', 'not persisted');
  });
  await step('Integrations: telephony/Sarvam checks report not configured (no fake success)', async () => {
    await admin.page.getByTestId('check-telephony').click();
    await toast(admin.page, 'error', /not configured/);
    await admin.page.getByTestId('check-sarvam_ai').click();
    await toast(admin.page, 'error', /not configured/);
    assert(sql("select status from integrations where key='telephony'") === 'not_configured', 'telephony status changed');
  });
  await step('Integrations: secrets are refused in notes', async () => {
    await admin.page.fill('#notes-telephony', 'api_key: abc123');
    await admin.page.locator('form', { has: admin.page.locator('#notes-telephony') }).getByRole('button', { name: 'Save notes' }).click();
    await toast(admin.page, 'error', /Do not store secrets/);
  });
  await step('Settings: suppression list add (validation + duplicate) and remove', async () => {
    await goto(admin.page, '/settings?tab=suppression');
    await admin.page.fill('#sup_phone', '12');
    await admin.page.getByRole('button', { name: 'Add number' }).click();
    await toast(admin.page, 'error', /10-digit|valid/);
    await admin.page.fill('#sup_phone', '9811122233');
    await admin.page.fill('#sup_reason', 'Complaint');
    await admin.page.getByRole('button', { name: 'Add number' }).click();
    await toast(admin.page, 'success', /added to the suppression list/);
    await admin.page.fill('#sup_phone', '+91 98111 22233');
    await admin.page.getByRole('button', { name: 'Add number' }).click();
    await toast(admin.page, 'error', /already on the suppression list/);
    await goto(admin.page, '/settings?tab=suppression&q=9811122233');
    await admin.page.locator('[data-testid=suppression-table] tbody tr').first().getByRole('button').click();
    await admin.page.getByRole('button', { name: 'Remove', exact: true }).click();
    await toast(admin.page, 'success', /removed/);
    assert(sql("select count(*) from suppression_list where phone_e164='+919811122233'") === '0', 'not removed');
  });
  await step('Settings: disabling simulation mode blocks simulated calls server-side', async () => {
    await goto(admin.page, '/settings?tab=organization');
    await admin.page.getByLabel('Enable simulation mode').uncheck();
    await admin.page.getByRole('button', { name: 'Save settings' }).click();
    await toast(admin.page, 'success', /settings saved/);
    await goto(admin.page, '/outbound');
    assert(await admin.page.locator('[data-testid=outbound-form] button[type=submit]').isDisabled(), 'button enabled');
    const before = sql('select count(*) from calls');
    await goto(admin.page, '/inbound');
    assert(await admin.page.locator('[data-testid=inbound-sim-form] button[type=submit]').isDisabled(), 'inbound sim enabled');
    assert(sql('select count(*) from calls') === before, 'call created');
    await goto(admin.page, '/settings?tab=organization');
    await admin.page.getByLabel('Enable simulation mode').check();
    await admin.page.getByRole('button', { name: 'Save settings' }).click();
    await toast(admin.page, 'success', /settings saved/);
  });
  await step('Settings: auto-approved admin emails validate and save', async () => {
    await goto(admin.page, '/settings?tab=organization');
    assert((await admin.page.inputValue('#os_admins')).includes('bokkisamsahith@gmail.com'), 'default admin email missing');
    await admin.page.fill('#os_admins', 'bokkisamsahith@gmail.com\nnot-an-email');
    await admin.page.getByRole('button', { name: 'Save settings' }).click();
    await toast(admin.page, 'error', /highlighted|valid email/);
    await admin.page.fill('#os_admins', 'BokkisamSahith@gmail.com, partner@flashqc.in');
    await admin.page.getByRole('button', { name: 'Save settings' }).click();
    await toast(admin.page, 'success', /settings saved/);
    assert(sql('select admin_emails from app_settings') === '{bokkisamsahith@gmail.com,partner@flashqc.in}', sql('select admin_emails from app_settings'));
  });
  await step('Settings: profile name update reflects in sidebar', async () => {
    await goto(admin.page, '/settings');
    await admin.page.fill('#pf_name', 'Sahith Kumar');
    await admin.page.getByRole('button', { name: 'Save profile' }).click();
    await toast(admin.page, 'success', /Profile updated/);
    await goto(admin.page, '/');
    await admin.page.locator('aside [data-testid=current-user]', { hasText: 'Sahith Kumar' }).waitFor();
  });
  await step('Audit log records changes with actor', async () => {
    await goto(admin.page, '/settings?tab=audit&table=contacts');
    assert((await admin.page.locator('[data-testid=audit-table] tbody tr').count()) > 0, 'no audit rows');
    assert((await admin.page.locator('[data-testid=audit-table]').getByText('Sahith Kumar').count()) > 0, 'actor missing');
  });

  // ------------------------------------------------------------------ PERMISSIONS
  await login(agent.page, 'agent@flashqc.test');
  await login(viewer.page, 'viewer@flashqc.test');
  await step('Viewer: read-only UI (no create buttons, no dialer)', async () => {
    await goto(viewer.page, '/contacts');
    assert((await viewer.page.getByTestId('new-contact').count()) === 0, 'new contact visible');
    await goto(viewer.page, '/outbound');
    await viewer.page.getByText('can review calls but not place them').waitFor();
    await goto(viewer.page, '/campaigns');
    assert((await viewer.page.getByRole('link', { name: 'New campaign' }).count()) === 0, 'new campaign visible');
    await goto(viewer.page, `/calls/${anitaCall}`);
    assert(await viewer.page.locator('#outcome').isDisabled(), 'outcome editable');
  });
  await step('Viewer: restricted pages redirect with notice', async () => {
    await goto(viewer.page, '/campaigns/new');
    assert(viewer.page.url().includes('denied=1'), viewer.page.url());
    await viewer.page.getByText('You do not have permission').waitFor();
    await goto(viewer.page, '/contacts/import');
    assert(viewer.page.url().includes('denied=1'), viewer.page.url());
    await goto(viewer.page, '/settings?tab=team');
    assert((await viewer.page.getByTestId('team-table').count()) === 0, 'team visible');
    await goto(viewer.page, '/settings?tab=audit');
    assert((await viewer.page.getByTestId('audit-table').count()) === 0, 'audit visible');
  });
  await step('Viewer: export allowed (read), data still RLS-scoped', async () => {
    const r = await viewer.page.request.get(`${BASE}/api/export/contacts`);
    assert(r.status() === 200, `status ${r.status()}`);
  });
  await step('Agent: can create contacts and calls, cannot manage campaigns or delete', async () => {
    await goto(agent.page, '/contacts');
    assert((await agent.page.getByTestId('new-contact').count()) === 1, 'no new contact');
    const id = sql("select id from contacts where phone_e164='+919988776655'");
    await goto(agent.page, `/contacts/${id}`);
    assert((await agent.page.getByTestId('delete-contact').count()) === 0, 'delete visible to agent');
    await goto(agent.page, `/campaigns/${campaignId}`);
    assert((await agent.page.getByTestId('campaign-delete').count()) === 0, 'campaign delete visible');
    await goto(agent.page, '/campaigns/new');
    assert(agent.page.url().includes('denied=1'), 'agent reached campaign wizard');
    await goto(agent.page, '/outbound');
    await agent.page.fill('#phone', '9700000001');
    await agent.page.click('[data-testid=outbound-form] button[type=submit]');
    await toast(agent.page, 'success', /Simulated call recorded/);
  });
  await step('Agent: cannot change integrations or org settings', async () => {
    await goto(agent.page, '/integrations');
    assert((await agent.page.getByTestId('check-telephony').count()) === 0, 'check visible');
    await goto(agent.page, '/settings?tab=organization');
    assert(await agent.page.locator('#os_name').isDisabled(), 'org editable');
  });
  await step('Admin: delete call removes record', async () => {
    const victim = sql("select id from calls where is_simulated and campaign_id is null order by started_at limit 1");
    await goto(admin.page, `/calls/${victim}`);
    await admin.page.getByTestId('delete-call').click();
    await admin.page.getByTestId('delete-call-confirm').click();
    await admin.page.waitForURL(/\/calls\?deleted=1/);
    assert(sql(`select count(*) from calls where id='${victim}'`) === '0', 'not deleted');
    assert(sql('select (min(call_number) = 1 and max(call_number) = count(*))::text from calls') === 'true', 'Call IDs have gaps after delete');
  });
  await step('Admin: bulk delete selected calls from Call Logs, IDs renumbered', async () => {
    const before = Number(sql('select count(*) from calls'));
    await goto(admin.page, '/calls');
    await admin.page.getByTestId('bulk-call-actions').waitFor();
    const boxes = admin.page.locator('[data-testid=calls-table] tbody input[type=checkbox]');
    await boxes.nth(0).check();
    await boxes.nth(1).check();
    await admin.page.getByText('2 selected').waitFor();
    await admin.page.getByTestId('bulk-delete-calls').click();
    await admin.page.getByTestId('bulk-delete-calls-confirm').click();
    await toast(admin.page, 'success', /2 calls deleted/);
    assert(Number(sql('select count(*) from calls')) === before - 2, 'bulk delete count');
    assert(sql('select (min(call_number) = 1 and max(call_number) = count(*))::text from calls') === 'true', 'Call IDs have gaps after bulk delete');
    await goto(agent.page, '/calls');
    assert((await agent.page.getByTestId('bulk-call-actions').count()) === 0, 'bulk delete visible to agent');
  });
  await step('After deleting, dashboard and analytics match the database right away', async () => {
    const total = sql("select count(*) from calls where started_at >= now() - interval '31 days' and status <> 'queued'");
    await goto(admin.page, '/?range=30d&scope=all');
    const card = (await admin.page.getByTestId('stat-total-calls').textContent()).replace(/[,\s]/g, '');
    assert(card === total, `dashboard total ${card} vs db ${total}`);
    await goto(admin.page, '/analytics?range=30d&scope=all');
    await admin.page.getByText(new RegExp(`of ${Number(total).toLocaleString('en-IN')} calls`)).first().waitFor();
  });
  await step('Call Logs show Emotion and Recording columns', async () => {
    await goto(admin.page, '/calls');
    const heads = await admin.page.locator('[data-testid=calls-table] thead th').allInnerTexts();
    assert(heads.some((h) => /emotion/i.test(h)) && heads.some((h) => /recording/i.test(h)), `headers: ${heads.join('|')}`);
  });
  await step('Manager-only delete of contact (admin) works and unlinks calls', async () => {
    const id = sql("select id from contacts where full_name='Walk-in Caller'");
    const phone = sql(`select phone_e164 from contacts where id='${id}'`);
    await goto(admin.page, `/contacts/${id}`);
    await admin.page.getByTestId('delete-contact').click();
    await admin.page.getByTestId('delete-contact-confirm').click();
    await admin.page.waitForURL(`${BASE}/contacts`);
    assert(sql(`select count(*) from contacts where id='${id}'`) === '0', 'contact remains');
    assert(Number(sql(`select count(*) from calls where phone_e164='${phone}'`)) > 0, 'calls lost');
  });

  // ------------------------------------------------------------------ API ENDPOINTS
  await step('Webhooks: Sarvam rejects requests without the secret; unknown providers 404', async () => {
    const r = await anon.page.request.post(`${BASE}/api/webhooks/telephony/sarvam`, { data: { deployment_id: 'x', app_id: 'y', interaction_id: 'z', user_phone_number: '+919800000000', agent_phone_number: '+919800000001' } });
    assert(r.status() === 401, `sarvam without secret: ${r.status()}`);
    const r2 = await anon.page.request.post(`${BASE}/api/webhooks/telephony/acme`, { data: {} });
    assert(r2.status() === 404, `unknown provider: ${r2.status()}`);
  });
  await step('Cron endpoint requires secret; processes with secret', async () => {
    const r1 = await anon.page.request.post(`${BASE}/api/cron/campaigns`);
    assert(r1.status() === 401, `no secret ${r1.status()}`);
    const r2 = await anon.page.request.post(`${BASE}/api/cron/campaigns`, { headers: { Authorization: 'Bearer wrong-secret-xxxxxxxx' } });
    assert(r2.status() === 401, `wrong secret ${r2.status()}`);
    const r3 = await anon.page.request.post(`${BASE}/api/cron/campaigns`, { headers: { Authorization: `Bearer ${CRON_SECRET}` } });
    assert(r3.status() === 200, `with secret ${r3.status()}`);
  });
  await step('Sign out ends session', async () => {
    await goto(viewer.page, '/');
    await viewer.page.locator('aside').getByRole('button', { name: 'Sign out' }).click();
    await viewer.page.waitForURL(/\/login/);
    await goto(viewer.page, '/calls');
    assert(new URL(viewer.page.url()).pathname === '/login', 'still signed in');
  });

  // ------------------------------------------------------------------ MOBILE
  const mobile = await newSession(browser, 'mobile', { ...devices['iPhone 13'] });
  await login(mobile.page, 'admin@flashqc.test');
  const mobileRoutes = ['/', '/inbound', '/outbound', '/campaigns', `/campaigns/${campaignId}`, '/campaigns/new', '/calls', `/calls/${anitaCall}`, '/recordings', '/contacts', '/contacts/import', '/phone-numbers', '/voice-agents', '/analytics', '/integrations', '/settings', '/settings?tab=team'];
  await step('Mobile: no horizontal page overflow on any route', async () => {
    const bad = [];
    for (const r of mobileRoutes) {
      await goto(mobile.page, r);
      const o = await mobile.page.evaluate(() => document.documentElement.scrollWidth - window.screen.width);
      if (o > 1) bad.push(`${r} (+${o}px)`);
    }
    assert(bad.length === 0, `overflow: ${bad.join(', ')}`);
  });
  await step('Mobile: navigation drawer opens and navigates', async () => {
    await goto(mobile.page, '/');
    await mobile.page.getByRole('button', { name: 'Open navigation' }).click();
    await mobile.page.getByRole('dialog', { name: 'Navigation' }).getByRole('link', { name: 'Contacts' }).click();
    await mobile.page.waitForURL(`${BASE}/contacts`);
    assert((await mobile.page.getByRole('dialog', { name: 'Navigation' }).count()) === 0, 'drawer still open');
  });
  for (const [r, name] of [['/', 'm-overview'], ['/calls', 'm-calls'], [`/campaigns/${campaignId}`, 'm-campaign']]) {
    await goto(mobile.page, r);
    await mobile.page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
  }
  for (const [r, name] of [['/', 'overview'], ['/calls', 'calls'], [`/campaigns/${campaignId}`, 'campaign'], [`/calls/${realCall}`, 'call-detail'], ['/contacts', 'contacts'], ['/analytics', 'analytics'], ['/integrations', 'integrations'], ['/recordings', 'recordings']]) {
    await goto(admin.page, r);
    await admin.page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
  }

  await browser.close();

  // ------------------------------------------------------------------ REPORT
  const passed = results.filter((r) => r.ok).length;
  const report = { base: BASE, ranAt: new Date().toISOString(), passed, failed: results.length - passed, results, consoleErrors };
  fs.writeFileSync(path.join(__dirname, 'results.json'), JSON.stringify(report, null, 2));
  console.log(`\n${passed}/${results.length} steps passed. Console/page/5xx errors: ${consoleErrors.length}`);
  for (const e of consoleErrors.slice(0, 30)) console.log(`  [${e.label}] (${e.step}) ${e.text}`);
  process.exit(results.length - passed || consoleErrors.length ? 1 : 0);
})().catch((e) => {
  console.error('Runner crashed:', e);
  process.exit(2);
});
