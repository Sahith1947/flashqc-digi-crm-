import 'server-only';

// Server-only configuration. NEVER import this from client components.
// Provider credentials are read here and never sent to the browser.
export const serverEnv = {
  supabaseSecretKey: process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  /** e.g. "sarvam", "exotel". Empty = no telephony provider configured. */
  telephonyProvider: (process.env.TELEPHONY_PROVIDER ?? '').trim().toLowerCase(),
  sarvamApiKey: process.env.SARVAM_API_KEY ?? '',
  telephonyWebhookSecret: process.env.TELEPHONY_WEBHOOK_SECRET ?? '',
  cronSecret: process.env.CRON_SECRET ?? '',
  /** 32 random bytes, base64. Encrypts provider OAuth tokens stored in the database. */
  integrationEncryptionKey: process.env.INTEGRATION_ENCRYPTION_KEY ?? '',
  /** Fallback secret to derive the encryption key from when INTEGRATION_ENCRYPTION_KEY is not set (hosted deploys). */
  supabaseJwtSecret: process.env.SUPABASE_JWT_SECRET ?? '',
  /** Sarvam voice-agents MCP endpoint. */
  sarvamMcpUrl: (process.env.SARVAM_MCP_URL ?? 'https://mcp.sarvam.ai/voice-agents').replace(/\/$/, ''),
};

/** Which credentials are present (booleans only – safe to show in the UI). */
export function credentialPresence() {
  return {
    SUPABASE_SECRET_KEY: Boolean(serverEnv.supabaseSecretKey),
    TELEPHONY_PROVIDER: Boolean(serverEnv.telephonyProvider),
    SARVAM_API_KEY: Boolean(serverEnv.sarvamApiKey),
    TELEPHONY_WEBHOOK_SECRET: Boolean(serverEnv.telephonyWebhookSecret),
    CRON_SECRET: Boolean(serverEnv.cronSecret),
    INTEGRATION_ENCRYPTION_KEY: Boolean(serverEnv.integrationEncryptionKey || serverEnv.supabaseJwtSecret || serverEnv.supabaseSecretKey),
  };
}
