import 'server-only';
import type { DB } from '@/lib/supabase/types';
import { serverEnv } from '@/server/env';
import { AppError } from '@/server/providers/types';
import { SarvamAuth } from './auth';

// Minimal MCP (Streamable HTTP, protocol 2025-06-18) client for Sarvam's server.
// One client = one MCP session. Handles JSON and SSE responses and refreshes
// the OAuth token once on 401.

const PROTOCOL = '2025-06-18';

interface RpcResponse {
  result?: { content?: { type: string; text?: string }[]; isError?: boolean; [k: string]: unknown };
  error?: { code: number; message: string };
}

export class SarvamMcpClient {
  private sessionId: string | null = null;
  private nextId = 1;
  private token: string | null = null;
  private initialized = false;

  constructor(private admin: DB) {}

  static async connect(admin: DB): Promise<SarvamMcpClient | null> {
    const c = new SarvamMcpClient(admin);
    c.token = await SarvamAuth.accessToken(admin);
    if (!c.token) return null;
    return c;
  }

  private async send(body: object, expectReply: boolean, retried = false): Promise<RpcResponse | null> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${this.token}`,
      'MCP-Protocol-Version': PROTOCOL,
    };
    if (this.sessionId) headers['Mcp-Session-Id'] = this.sessionId;
    const res = await fetch(serverEnv.sarvamMcpUrl, { method: 'POST', headers, body: JSON.stringify(body), cache: 'no-store', signal: AbortSignal.timeout(60_000) });
    if (res.status === 401 && !retried) {
      this.token = await SarvamAuth.accessToken(this.admin, { forceRefresh: true });
      return this.send(body, expectReply, true);
    }
    if (res.status === 401) throw new AppError('Sarvam rejected the session. Reconnect Sarvam on the Integrations page.', 'sarvam_reconnect');
    if (!res.ok && res.status !== 202) throw new AppError(`Sarvam MCP error (HTTP ${res.status}).`, 'sarvam_http');
    const sid = res.headers.get('mcp-session-id');
    if (sid) this.sessionId = sid;
    const text = await res.text();
    if (!expectReply || !text.trim()) return null;
    if ((res.headers.get('content-type') ?? '').includes('text/event-stream')) {
      const id = (body as { id?: number }).id;
      for (const line of text.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const msg = JSON.parse(line.slice(5)) as RpcResponse & { id?: number };
        if (msg.id === id) return msg;
      }
      return null;
    }
    return JSON.parse(text) as RpcResponse;
  }

  private async ensureInit() {
    if (this.initialized) return;
    const r = await this.send(
      { jsonrpc: '2.0', id: this.nextId++, method: 'initialize', params: { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'flashqc-digi-crm', version: '1.0' } } },
      true,
    );
    if (!r?.result) throw new AppError(`Sarvam MCP initialize failed: ${r?.error?.message ?? 'no response'}`, 'sarvam_http');
    await this.send({ jsonrpc: '2.0', method: 'notifications/initialized' }, false);
    this.initialized = true;
  }

  /** Calls a tool and returns its parsed JSON payload. Throws AppError on tool errors. */
  async callTool<T = unknown>(name: string, args: Record<string, unknown>): Promise<T> {
    await this.ensureInit();
    const r = await this.send({ jsonrpc: '2.0', id: this.nextId++, method: 'tools/call', params: { name, arguments: args } }, true);
    if (!r) throw new AppError(`No response from Sarvam for ${name}.`, 'sarvam_http');
    if (r.error) throw new AppError(`Sarvam ${name} failed: ${r.error.message}`, 'sarvam_tool');
    const text = r.result?.content?.find((c) => c.type === 'text')?.text ?? '';
    if (r.result?.isError) throw new AppError(`Sarvam ${name} failed: ${text.slice(0, 300)}`, 'sarvam_tool');
    try {
      return JSON.parse(text) as T;
    } catch {
      return text as unknown as T;
    }
  }

  async listToolNames(): Promise<string[]> {
    await this.ensureInit();
    const r = await this.send({ jsonrpc: '2.0', id: this.nextId++, method: 'tools/list', params: {} }, true);
    return ((r?.result?.tools as { name: string }[] | undefined) ?? []).map((t) => t.name);
  }
}
