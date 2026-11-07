import 'server-only';
import type { DB } from '@/lib/supabase/types';
import { createAdminClient } from '@/lib/supabase/admin';
import { getVoiceAgentProvider } from '@/server/providers/registry';
import { AppError, ProviderNotConfiguredError } from '@/server/providers/types';

export const VoiceAgentService = {
  isSyncAvailable() {
    return getVoiceAgentProvider().configured;
  },

  /**
   * PHASE 2: pushes the agent definition to the voice AI provider and, on a
   * verified response, marks it connected (backend client only).
   */
  async syncToProvider(db: DB, agentId: string) {
    const provider = getVoiceAgentProvider();
    if (!provider.configured) throw new ProviderNotConfiguredError('Voice agent sync');
    const admin = createAdminClient();
    if (!admin) throw new AppError('SUPABASE_SECRET_KEY is required for provider sync');

    const { data: agent, error } = await db.from('voice_agents').select('*').eq('id', agentId).single();
    if (error) throw error;
    try {
      const res = await provider.upsertAgent({
        name: agent.name,
        language: agent.language,
        voice: agent.voice,
        greeting: agent.greeting,
        instructions: agent.instructions,
        providerAgentId: agent.provider_agent_id,
      });
      await admin
        .from('voice_agents')
        .update({ provider_agent_id: res.providerAgentId, connection_status: 'connected' })
        .eq('id', agentId);
    } catch (e) {
      await admin.from('voice_agents').update({ connection_status: 'error' }).eq('id', agentId);
      throw e;
    }
  },
};
