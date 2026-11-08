import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import type { DB } from '@/lib/supabase/types';
import { serverEnv } from '@/server/env';
import { decryptSecret, encryptSecret } from '@/server/crypto';
import { AppError } from '@/server/providers/types';

// OAuth 2.1 for Sarvam's MCP server: dynamic client registration, PKCE, and
// Sarvam's device-approval step (the user approves a short code on
// indus.sarvam.ai). Tokens are stored AES-GCM encrypted in
// integration_credentials, which only the backend (service role) can access.

const CREDS_KEY = 'sarvam_ai';
const PENDING_KEY = 'sarvam_ai_pending';
const REDIRECT_URI = 'http://localhost:53682/callback'; // never loaded: the code is read from the device status API

interface StoredTokens {
  access_token: string;
  refresh_token: string | null;
  expires_at: number; // epoch ms
  client_id: string;
}
interface PendingFlow {
  client_id: string;
  verifier: string;
  state: string;
  status_url: string;
  user_code: string;
  verify_url: string;
  started_at: number;
}

const base = () => serverEnv.sarvamMcpUrl;
const b64url = (b: Buffer) => b.toString('base64url');

async function readRow(admin: DB, key: string) {
  const { data, error } = await admin.from('integration_credentials').select('ciphertext, metadata, updated_at').eq('key', key).maybeSingle();
  if (error) throw error;
  return data;
}

async function writeRow(admin: DB, key: string, secret: object, metadata: Record<string, unknown>) {
  const { error } = await admin
    .from('integration_credentials')
    .upsert({ key, ciphertext: encryptSecret(JSON.stringify(secret), key), metadata: metadata as never }, { onConflict: 'key' });
  if (error) throw error;
}

function claims(jwt: string): Record<string, unknown> {
  try {
    return JSON.parse(Buffer.from(jwt.split('.')[1] ?? '', 'base64url').toString('utf8'));
  } catch {
    return {};
  }
}

async function postForm(url: string, body: Record<string, string>) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(body),
    cache: 'no-store',
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new AppError(`Sarvam sign-in failed: ${String(json.error_description ?? json.error ?? res.status)}`, 'sarvam_auth');
  return json;
}

async function registerClient(): Promise<string> {
  const res = await fetch(`${base()}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: 'FlashQC Digi Call CRM',
      redirect_uris: [REDIRECT_URI],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }),
    cache: 'no-store',
  });
  const json = (await res.json().catch(() => ({}))) as { client_id?: string };
  if (!res.ok || !json.client_id) throw new AppError('Could not register with Sarvam. Try again later.', 'sarvam_auth');
  return json.client_id;
}

async function saveTokens(admin: DB, tok: Record<string, unknown>, clientId: string, previousRefresh: string | null) {
  const access = String(tok.access_token ?? '');
  if (!access) throw new AppError('Sarvam did not return an access token.', 'sarvam_auth');
  const stored: StoredTokens = {
    access_token: access,
    refresh_token: (tok.refresh_token as string | undefined) ?? previousRefresh,
    expires_at: Date.now() + Number(tok.expires_in ?? 3600) * 1000,
    client_id: clientId,
  };
  const c = claims(access);
  await writeRow(admin, CREDS_KEY, stored, {
    account_email: typeof c.email === 'string' ? c.email : null,
    workspace_id: typeof c.workspace_id === 'string' ? c.workspace_id : null,
    expires_at: new Date(stored.expires_at).toISOString(),
    connected_at: new Date().toISOString(),
  });
  return stored;
}

export const SarvamAuth = {
  /** Non-secret connection facts for the UI. */
  async status(admin: DB) {
    const [row, pending] = await Promise.all([readRow(admin, CREDS_KEY), readRow(admin, PENDING_KEY)]);
    const pendingMeta = (pending?.metadata ?? null) as { user_code?: string; verify_url?: string; started_at?: number } | null;
    const pendingFresh = pendingMeta?.started_at && Date.now() - pendingMeta.started_at < 14 * 60 * 1000;
    return {
      connected: Boolean(row),
      accountEmail: (row?.metadata as { account_email?: string } | undefined)?.account_email ?? null,
      connectedAt: (row?.metadata as { connected_at?: string } | undefined)?.connected_at ?? null,
      pending: pendingFresh ? { userCode: pendingMeta!.user_code!, verifyUrl: pendingMeta!.verify_url! } : null,
    };
  },

  /** Step 1: start sign-in. Returns the code and link the admin approves on Sarvam. */
  async startConnect(admin: DB): Promise<{ userCode: string; verifyUrl: string }> {
    const clientId = await registerClient();
    const verifier = b64url(randomBytes(48));
    const state = b64url(randomBytes(16));
    const challenge = b64url(createHash('sha256').update(verifier).digest());
    const authorize = new URL(`${base()}/authorize`);
    Object.entries({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state,
      resource: base(),
    }).forEach(([k, v]) => authorize.searchParams.set(k, v));

    const first = await fetch(authorize, { redirect: 'manual', cache: 'no-store' });
    const waitUrl = first.headers.get('location');
    if (!waitUrl) throw new AppError('Sarvam did not start the sign-in. Try again.', 'sarvam_auth');
    const wait = new URL(waitUrl, authorize);
    const userCode = wait.searchParams.get('user_code');
    const verifyUrl = wait.searchParams.get('verify');
    const page = await (await fetch(wait, { cache: 'no-store' })).text();
    const statusRel = /data-status-url="([^"]+)"/.exec(page)?.[1]?.replace(/&amp;/g, '&');
    if (!userCode || !verifyUrl || !statusRel) throw new AppError('Unexpected response from Sarvam sign-in.', 'sarvam_auth');
    if (!/^https:\/\/([a-z0-9-]+\.)*sarvam\.ai\//.test(verifyUrl)) throw new AppError('Unexpected approval link from Sarvam.', 'sarvam_auth');

    const flow: PendingFlow = {
      client_id: clientId,
      verifier,
      state,
      status_url: new URL(statusRel, wait).toString(),
      user_code: userCode,
      verify_url: verifyUrl,
      started_at: Date.now(),
    };
    await writeRow(admin, PENDING_KEY, flow, { user_code: userCode, verify_url: verifyUrl, started_at: flow.started_at });
    return { userCode, verifyUrl };
  },

  /** Step 2: check whether the admin approved; on approval exchange the code and store tokens. */
  async pollConnect(admin: DB): Promise<'waiting' | 'connected' | 'expired' | 'none'> {
    const row = await readRow(admin, PENDING_KEY);
    if (!row) return 'none';
    const flow = JSON.parse(decryptSecret(row.ciphertext, PENDING_KEY)) as PendingFlow;
    const res = await fetch(flow.status_url, { headers: { Accept: 'application/json' }, cache: 'no-store' });
    const st = (await res.json().catch(() => ({}))) as { status?: string; redirect_url?: string; detail?: string };
    if (st.status === 'waiting') return 'waiting';
    if (st.status !== 'redirect' || !st.redirect_url) {
      await admin.from('integration_credentials').delete().eq('key', PENDING_KEY);
      return 'expired';
    }
    const q = new URL(st.redirect_url).searchParams;
    if (q.get('error') || q.get('state') !== flow.state || !q.get('code')) {
      await admin.from('integration_credentials').delete().eq('key', PENDING_KEY);
      return 'expired';
    }
    const tok = await postForm(`${base()}/token`, {
      grant_type: 'authorization_code',
      code: q.get('code')!,
      redirect_uri: REDIRECT_URI,
      client_id: flow.client_id,
      code_verifier: flow.verifier,
      resource: base(),
    });
    await saveTokens(admin, tok, flow.client_id, null);
    await admin.from('integration_credentials').delete().eq('key', PENDING_KEY);
    return 'connected';
  },

  async cancelConnect(admin: DB) {
    await admin.from('integration_credentials').delete().eq('key', PENDING_KEY);
  },

  async disconnect(admin: DB) {
    const { error } = await admin.from('integration_credentials').delete().in('key', [CREDS_KEY, PENDING_KEY]);
    if (error) throw error;
  },

  /** A valid access token, refreshed when within 2 minutes of expiry. Null when not connected. */
  async accessToken(admin: DB, opts: { forceRefresh?: boolean } = {}): Promise<string | null> {
    const row = await readRow(admin, CREDS_KEY);
    if (!row) return null;
    const t = JSON.parse(decryptSecret(row.ciphertext, CREDS_KEY)) as StoredTokens;
    if (!opts.forceRefresh && t.expires_at - Date.now() > 120_000) return t.access_token;
    if (!t.refresh_token) throw new AppError('Sarvam session expired. Reconnect Sarvam on the Integrations page.', 'sarvam_reconnect');
    try {
      const tok = await postForm(`${base()}/token`, {
        grant_type: 'refresh_token',
        refresh_token: t.refresh_token,
        client_id: t.client_id,
        resource: base(),
      });
      return (await saveTokens(admin, tok, t.client_id, t.refresh_token)).access_token;
    } catch {
      throw new AppError('Sarvam session expired. Reconnect Sarvam on the Integrations page.', 'sarvam_reconnect');
    }
  },

  /** org_id / workspace_id from the saved sign-in token (readable even after the token expires). */
  async workspace(admin: DB): Promise<{ orgId: string; workspaceId: string } | null> {
    const row = await readRow(admin, CREDS_KEY);
    if (!row) return null;
    try {
      const t = JSON.parse(decryptSecret(row.ciphertext, CREDS_KEY)) as StoredTokens;
      const claims = JSON.parse(Buffer.from(t.access_token.split('.')[1], 'base64url').toString('utf8')) as { org_id?: string; workspace_id?: string };
      return claims.org_id && claims.workspace_id ? { orgId: claims.org_id, workspaceId: claims.workspace_id } : null;
    } catch {
      return null;
    }
  },

  /** Used once to adopt an already-approved token (e.g. from a CLI sign-in). */
  async importTokens(admin: DB, tok: Record<string, unknown>, clientId: string) {
    return saveTokens(admin, tok, clientId, null);
  },
};
