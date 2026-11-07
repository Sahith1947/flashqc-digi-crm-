# Phase 2 – Integration Status & Remaining Requirements

## Status (7 Nov 2026)

**Sarvam AI is connected** through its official MCP server (`https://mcp.sarvam.ai/voice-agents`), verified against the live workspace of ryugar672@gmail.com.

| Capability | Status |
| --- | --- |
| Sign-in from the CRM (Integrations → **Connect Sarvam**): OAuth 2.1 + PKCE with Sarvam's code-approval step; tokens AES-256-GCM encrypted in `integration_credentials` (backend-only), auto-refreshed | ✅ Done, tested |
| Verified health check (status "Connected" only when Sarvam answers) | ✅ Done, tested |
| **Voice agent sync** Sarvam → CRM (name, Sarvam ID, status, version, deployed, languages, greeting). Read-only towards Sarvam; idempotent | ✅ Done, tested (1 agent: *FlashQC Digi Sales Executive*, draft v2, not deployed) |
| Telephony check + **number sync** from Sarvam connections | ✅ Done, tested. Vobiz connection is *connection successful*, **0 numbers onboarded** → status "Configured" |
| Live outbound / campaign calling via Sarvam campaigns | ⏳ Blocked: needs an onboarded number and your decisions below |
| Call-end webhooks → call logs, transcripts, recordings | ⏳ Next, after a campaign can run (`sarvam://schemas/webhook-payload`) |
| AI summaries / transcripts | ⏳ Arrive with the call-end webhook (Sarvam provides transcript, variables incl. `call_summary`) |

### Sarvam MCP capabilities discovered
`agents`, `configure_agent`, `telephony`, `configure_endpoint` (onboard numbers), `configure_deployment` (inbound), `campaigns`, `configure_campaign`, `stream_cohort_users` (push CRM contacts, 1000/batch), `dnd`, `analytics`, `verify_phone_number` + `place_test_call`, `send_chat`, knowledge bases, evals, boards.

### Decisions needed from you before any live call (these spend Sarvam credits)
1. **Onboard a Vobiz number** in Sarvam (Sarvam dashboard, or I can run `configure_endpoint` once you confirm which number).
2. **Commit/publish the agent** (it is a draft; campaigns use a committed version).
3. **Caller ID** to dial from, **dial rate**, **retry policy** and **calling hours** for campaigns.
4. A public HTTPS URL for the CRM (deployment) so Sarvam's call-end webhooks can reach `/api/webhooks/telephony/sarvam`.

> Local note: this cloud sandbox needs `NODE_USE_ENV_PROXY=1` for Node to reach Sarvam through its proxy. Normal hosting (Vercel, your Mac) needs nothing extra.

---


Phase 1 delivered the complete CRM with no external integrations. This document
lists exactly what is needed to connect Sarvam AI, MCP and a telephony provider,
and where each piece plugs in. **Nothing below has been assumed or
implemented**; each item will be built strictly from the official documentation.

## 1. What I need from you

### Sarvam AI
- [ ] Official API documentation (base URLs, auth scheme, rate limits, regions).
- [ ] MCP server details: endpoint/transport, authentication, and the **list of tools it actually exposes**, with input/output schemas.
- [ ] Which of these Sarvam supports, and through which interface (REST API vs MCP):
  - Voice agent create/update (agent definition: language, voice, greeting, instructions)
  - Outbound call placement by an agent
  - Inbound call handling by an agent
  - Call status events / webhooks (and their signature scheme)
  - Recording access (URL format, expiry, auth)
  - Speech-to-text transcription (batch and/or streaming; diarisation; supported languages)
  - Call summarisation (or whether we use a Sarvam LLM endpoint with our own prompt)
- [ ] API key(s) for a test account → set as `SARVAM_API_KEY` on the server (never in the database).
- [ ] Available voices and language codes (to populate the Voice Agent form).

### Telephony provider (if different from Sarvam)
- [ ] Provider name (e.g. Exotel, Plivo, Twilio, Knowlarity) and API documentation.
- [ ] Account credentials (server env vars only) and the webhook signing secret → `TELEPHONY_WEBHOOK_SECRET`.
- [ ] Virtual / business numbers to connect (DLT/TRAI registration details if applicable).
- [ ] Call-status callback format, recording callback format, and how inbound calls are routed to an agent.
- [ ] Whether the provider bridges calls to Sarvam (SIP/WebSocket media streaming) or Sarvam dials directly.

### Compliance / business decisions
- [ ] DLT/TRAI requirements for your use case (promotional vs transactional/service calls), and whether a DND registry lookup API should be integrated.
- [ ] Recording consent announcement requirements.
- [ ] Data retention period for recordings and transcripts.
- [ ] Production Supabase project (or confirmation to create one) and deployment target (e.g. Vercel).

## 2. Where each integration plugs in

All provider code goes in `src/server/providers/` and is selected in
`src/server/providers/registry.ts`. Services and UI do not change shape.

| Capability | Interface (`providers/types.ts`) | Used by | UI that lights up |
| --- | --- | --- | --- |
| Place live outbound call | `TelephonyProvider.placeOutboundCall` | `TelephonyService.startOutboundCall`, `CampaignService.processBatch` | "Live call" option in Outbound; Live campaign mode |
| Call status / inbound events | `TelephonyProvider.verifyWebhook` + `parseWebhook` → `NormalizedCallEvent` | `POST /api/webhooks/telephony/[provider]` → `CallEventService.ingestProviderEvent` | Inbound history, call timelines, campaign outcomes |
| Hang up | `TelephonyProvider.hangup` | (to add: call detail control) | — |
| Provider recordings | `RecordingSourceProvider.getPlaybackUrl` | `RecordingService.getPlaybackUrl` | Recording players for `source = provider` rows |
| Voice agent sync | `VoiceAgentProvider.upsertAgent` | `VoiceAgentService.syncToProvider` | "Sync to Sarvam" button, agent "Connected" status |
| Transcription | `TranscriptionProvider.transcribe` | `TranscriptService.generateTranscript` | Transcript card |
| AI summaries | `SummaryProvider.summarize` | `TranscriptService.generateSummary` | "Generate" button on AI summary card |
| Health checks | `healthCheck()` | `IntegrationService.check` | Integrations page "Check connection" |

### Already in place for Phase 2
- Webhook endpoint with payload size limit, provider routing, signature-verification hook, idempotent event ingestion, inbound call creation, contact/line/agent linking, recording registration and campaign-contact sync.
- Backend-only write path (service role) for every provider-confirmed field; database guards reject the same writes from user sessions.
- Scheduled processing endpoint (`/api/cron/campaigns`) and calling-window enforcement for live campaigns.
- Live campaigns stay `in_progress` per contact until the webhook reports the verified result.
- Integration status rows (`sarvam_ai`, `telephony`, `recording_storage`) with last-check time and error.

## 3. Phase 2 implementation plan (once docs arrive)
1. Read the documentation and MCP tool list; map each supported operation to the interfaces above and mark unsupported ones explicitly.
2. Implement adapters + webhook signature verification; unit-test them against recorded sample payloads from the docs.
3. Register adapters in `registry.ts`; set env vars in a test environment.
4. Verify with real test calls: outbound, inbound, no-answer, busy, failure, recording, transcript, summary.
5. Turn on live campaign mode; run a small live pilot; then consider disabling simulation mode in Settings.

## 4. Known limitations of Phase 1 (by design)
- No real calls, recordings, transcripts or AI summaries are produced. Recordings can be uploaded manually (real audio only); transcripts and summaries can be entered manually and are labelled "Manual".
- Simulated campaigns progress while the campaign page is open, or via the cron endpoint.
- DND status is recorded per contact (manual/CSV); there is no live NCPR registry lookup.
